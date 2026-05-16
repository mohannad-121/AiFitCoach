from __future__ import annotations

import argparse
import json
import pickle
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline, FeatureUnion
from sklearn.svm import LinearSVC
from sklearn.ensemble import VotingClassifier
from sklearn.metrics import make_scorer, f1_score

from train_conversation_intent_model import _dataset_text, _load_training_pairs
from nlp_utils import normalize_text, repair_mojibake_deep


DEFAULT_INTENTS_PATH = Path(__file__).resolve().parent / "data" / "chat data" / "conversation_intents.json"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "model_plan_intent_retrained.pkl"


def build_candidate_pipelines():
    pipelines = []

    pipelines.append(
        (
            "tfidf_logistic_large",
            Pipeline(
                steps=[
                    (
                        "tfidf",
                        TfidfVectorizer(
                            ngram_range=(1, 3),
                            max_features=50000,
                            sublinear_tf=True,
                            preprocessor=normalize_text,
                        ),
                    ),
                    ("model", LogisticRegression(max_iter=10000, class_weight="balanced", C=2.0)),
                ]
            ),
        )
    )

    pipelines.append(
        (
            "word_char_ensemble",
            Pipeline(
                steps=[
                    (
                        "features",
                        FeatureUnion(
                            [
                                (
                                    "word",
                                    TfidfVectorizer(
                                        ngram_range=(1, 2),
                                        sublinear_tf=True,
                                        preprocessor=normalize_text,
                                        max_features=30000,
                                    ),
                                ),
                                (
                                    "char",
                                    TfidfVectorizer(
                                        analyzer="char_wb",
                                        ngram_range=(3, 6),
                                        min_df=2,
                                        sublinear_tf=True,
                                        preprocessor=normalize_text,
                                        max_features=20000,
                                    ),
                                ),
                            ]
                        ),
                    ),
                    (
                        "model",
                        LogisticRegression(max_iter=10000, class_weight="balanced", C=3.0),
                    ),
                ]
            ),
        )
    )

    pipelines.append(
        (
            "char_svc",
            Pipeline(
                steps=[
                    (
                        "tfidf",
                        TfidfVectorizer(
                            analyzer="char_wb",
                            ngram_range=(3, 6),
                            min_df=1,
                            sublinear_tf=True,
                            preprocessor=normalize_text,
                            max_features=40000,
                        ),
                    ),
                    ("model", LinearSVC(class_weight="balanced", C=1.0, max_iter=20000)),
                ]
            ),
        )
    )

    return pipelines


def main():
    parser = argparse.ArgumentParser(description="Retrain conversation intent with cross-val and larger pipelines.")
    parser.add_argument("--intents", type=Path, default=DEFAULT_INTENTS_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--include-responses", action=argparse.BooleanOptionalAction, default=True)
    args = parser.parse_args()

    pairs = _load_training_pairs(args.intents, include_responses=args.include_responses)
    if not pairs:
        raise SystemExit("No training pairs found")

    texts, labels = zip(*pairs)
    texts = list(texts)
    labels = list(labels)

    skf = StratifiedKFold(n_splits=args.folds, shuffle=True, random_state=42)
    scorer = make_scorer(f1_score, average="weighted")

    best_name = None
    best_score = -1.0
    best_pipeline = None

    for name, pipeline in build_candidate_pipelines():
        try:
            fold_scores = []
            for train_idx, test_idx in skf.split(texts, labels):
                X_train = [texts[i] for i in train_idx]
                y_train = [labels[i] for i in train_idx]
                X_test = [texts[i] for i in test_idx]
                y_test = [labels[i] for i in test_idx]

                pipeline.fit(X_train, y_train)
                y_pred = pipeline.predict(X_test)
                score = f1_score(y_test, y_pred, average="weighted")
                fold_scores.append(score)

            mean_score = float(np.mean(fold_scores))
            std_score = float(np.std(fold_scores))
            print(f"{name}: mean weighted-F1={mean_score:.4f} (std={std_score:.4f})")
            if mean_score > best_score:
                best_score = mean_score
                best_name = name
                best_pipeline = pipeline
        except Exception as exc:
            print(f"{name} failed: {exc}")

    if best_pipeline is None:
        raise SystemExit("No pipeline succeeded")

    # Fit best pipeline on full data
    best_pipeline.fit(texts, labels)

    artifact = {
        "model": best_pipeline,
        "model_name": best_name,
        "labels": sorted(set(labels)),
        "metrics": {"cv_weighted_f1": float(best_score)},
        "dataset_path": str(args.intents),
        "dataset_rows": int(len(labels)),
        "include_responses": bool(args.include_responses),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("wb") as f:
        pickle.dump(artifact, f)

    print(f"Saved retrained model: {args.output}")
    print(f"Best pipeline: {best_name}")
    print(f"CV weighted-F1: {best_score:.4f}")


if __name__ == "__main__":
    main()
