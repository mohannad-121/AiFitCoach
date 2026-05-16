"""
Train MORE NEW datasets (different from the previous 16).
Using different columns and files for brand new classification tasks.
"""
from __future__ import annotations

import json
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


DATASET_ROOT = Path(__file__).resolve().parent / "datasets"
OUTPUT_PATH = Path(__file__).resolve().parent / "data" / "derived" / "more_new_datasets_benchmark.json"
RANDOM_STATE = 42


@dataclass
class BenchmarkConfig:
    name: str
    filename: str
    prepare: Callable[[pd.DataFrame], tuple[pd.DataFrame, pd.Series, dict[str, Any]]]


def _quantile_target(series: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    quantiles = pd.qcut(numeric, q=3, duplicates="drop")
    categories = list(quantiles.cat.categories)
    if not categories:
        return pd.Series([pd.NA] * len(series), name=series.name)
    label_bank = ["low", "medium", "high"]
    labels = label_bank[: len(categories)]
    renamed = quantiles.cat.rename_categories(labels)
    return pd.Series(renamed, name=series.name)


def _train_and_score(X: pd.DataFrame, y: pd.Series) -> dict[str, Any]:
    data = X.copy()
    target = pd.Series(y).copy()
    mask = target.notna()
    data = data.loc[mask].reset_index(drop=True)
    target = target.loc[mask].reset_index(drop=True)

    if data.empty:
        raise ValueError("No usable rows after filtering target.")
    if target.nunique() < 2:
        raise ValueError("Need at least 2 target classes for training.")

    numeric_columns = [col for col in data.columns if pd.api.types.is_numeric_dtype(data[col])]
    categorical_columns = [col for col in data.columns if col not in numeric_columns]

    transformers: list[tuple[str, Any, list[str]]] = []
    if numeric_columns:
        transformers.append(
            (
                "num",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                numeric_columns,
            )
        )
    if categorical_columns:
        transformers.append(
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("encoder", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical_columns,
            )
        )

    preprocessor = ColumnTransformer(transformers=transformers)

    X_train, X_test, y_train, y_test = train_test_split(
        data,
        target,
        test_size=0.2,
        random_state=RANDOM_STATE,
        stratify=target,
    )

    candidates = {
        "logistic_regression": Pipeline(
            steps=[
                ("preprocess", preprocessor),
                (
                    "model",
                    LogisticRegression(max_iter=4000, class_weight="balanced"),
                ),
            ]
        ),
        "random_forest": Pipeline(
            steps=[
                ("preprocess", preprocessor),
                (
                    "model",
                    RandomForestClassifier(
                        n_estimators=100,
                        random_state=RANDOM_STATE,
                        class_weight="balanced_subsample",
                        n_jobs=-1,
                        max_depth=20,
                    ),
                ),
            ]
        ),
    }

    best_name = ""
    best_metrics: dict[str, Any] | None = None

    baseline_accuracy = float(target.value_counts(normalize=True).iloc[0])
    class_distribution = {str(label): int(count) for label, count in target.value_counts().to_dict().items()}

    for name, pipeline in candidates.items():
        pipeline.fit(X_train, y_train)
        predictions = pipeline.predict(X_test)
        metrics = {
            "model_name": name,
            "accuracy": float(accuracy_score(y_test, predictions)),
            "weighted_f1": float(f1_score(y_test, predictions, average="weighted")),
        }
        if best_metrics is None or metrics["weighted_f1"] > best_metrics["weighted_f1"]:
            best_name = name
            best_metrics = metrics

    if best_metrics is None:
        raise ValueError("No model metrics produced.")

    return {
        "rows_used": int(len(data)),
        "feature_count": int(data.shape[1]),
        "numeric_feature_count": int(len(numeric_columns)),
        "categorical_feature_count": int(len(categorical_columns)),
        "class_count": int(target.nunique()),
        "class_distribution": class_distribution,
        "baseline_accuracy": baseline_accuracy,
        "best_model": best_name,
        "best_metrics": best_metrics,
    }


# MORE NEW DATASETS (not trained in previous 16)
def _minute_calories_wide_band(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """Minute-level calories (wide format) classification."""
    work = df.copy()
    if len(work) > 5000:
        work = work.sample(n=5000, random_state=RANDOM_STATE)
    if "Calories" in work.columns:
        cal_band = _quantile_target(work["Calories"])
        feature_columns = [col for col in work.columns if col != "Calories"][:25]
        return work[feature_columns], pd.Series(cal_band, name="minute_cal_wide_band"), {
            "target": "derived_minute_calorie_wide_band",
            "notes": "3-class minute-level calorie band (wide format).",
        }
    raise ValueError("Calories column not found")


def _minute_steps_wide_band(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """Minute-level steps (wide format) classification."""
    work = df.copy()
    if len(work) > 5000:
        work = work.sample(n=5000, random_state=RANDOM_STATE)
    if "Steps" in work.columns:
        steps_band = _quantile_target(work["Steps"])
        feature_columns = [col for col in work.columns if col != "Steps"][:25]
        return work[feature_columns], pd.Series(steps_band, name="minute_steps_wide_band"), {
            "target": "derived_minute_steps_wide_band",
            "notes": "3-class minute-level steps band (wide format).",
        }
    raise ValueError("Steps column not found")


def _minute_intensities_wide_band(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """Minute-level intensities (wide format) classification."""
    work = df.copy()
    if len(work) > 5000:
        work = work.sample(n=5000, random_state=RANDOM_STATE)
    if "TotalIntensity" in work.columns:
        intensity_band = _quantile_target(work["TotalIntensity"])
        feature_columns = [col for col in work.columns if col != "TotalIntensity"][:25]
        return work[feature_columns], pd.Series(intensity_band, name="minute_intensity_wide_band"), {
            "target": "derived_minute_intensity_wide_band",
            "notes": "3-class minute-level intensity band (wide format).",
        }
    raise ValueError("TotalIntensity column not found")


def _hourly_intensities_band(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """Hourly intensity classification."""
    work = df.copy()
    if len(work) > 5000:
        work = work.sample(n=5000, random_state=RANDOM_STATE)
    if "TotalIntensity" in work.columns:
        intensity_band = _quantile_target(work["TotalIntensity"])
        feature_columns = [col for col in work.columns if col != "TotalIntensity"]
        return work[feature_columns], pd.Series(intensity_band, name="hourly_intensity_band"), {
            "target": "derived_hourly_intensity_band",
            "notes": "3-class hourly intensity band.",
        }
    raise ValueError("TotalIntensity column not found")


def _minute_mets_band(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """METs (metabolic equivalent) classification."""
    work = df.copy()
    if len(work) > 5000:
        work = work.sample(n=5000, random_state=RANDOM_STATE)
    if "METs" in work.columns:
        mets_band = _quantile_target(work["METs"])
        feature_columns = [col for col in work.columns if col != "METs"][:20]
        return work[feature_columns], pd.Series(mets_band, name="mets_band"), {
            "target": "derived_mets_band",
            "notes": "3-class metabolic rate band.",
        }
    raise ValueError("METs column not found")


def _minute_sleep_band(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """Sleep value classification."""
    work = df.copy()
    if len(work) > 5000:
        work = work.sample(n=5000, random_state=RANDOM_STATE)
    if "value" in work.columns:
        sleep_band = _quantile_target(work["value"])
        feature_columns = [col for col in work.columns if col != "value"][:20]
        return work[feature_columns], pd.Series(sleep_band, name="minute_sleep_band"), {
            "target": "derived_minute_sleep_band",
            "notes": "3-class minute-level sleep classification.",
        }
    raise ValueError("value column not found")


def _fitness_workout_level(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """Fitness and workout performance level."""
    work = df.copy()
    if len(work) > 5000:
        work = work.sample(n=5000, random_state=RANDOM_STATE)
    numeric_cols = work.select_dtypes(include=[np.number]).columns.tolist()
    if numeric_cols:
        target_col = numeric_cols[0]
        perf_band = _quantile_target(work[target_col])
        feature_columns = [col for col in work.columns if col != target_col][:20]
        return work[feature_columns], pd.Series(perf_band, name="fitness_level"), {
            "target": "derived_fitness_level_band",
            "notes": f"3-class fitness performance level from {target_col}.",
        }
    raise ValueError("No numeric columns found")


def _gym_members_intensity(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """Gym member exercise intensity classification."""
    work = df.copy()
    if len(work) > 5000:
        work = work.sample(n=5000, random_state=RANDOM_STATE)
    numeric_cols = work.select_dtypes(include=[np.number]).columns.tolist()
    if numeric_cols:
        target_col = numeric_cols[0]
        intensity_band = _quantile_target(work[target_col])
        feature_columns = [col for col in work.columns if col != target_col][:25]
        return work[feature_columns], pd.Series(intensity_band, name="gym_intensity"), {
            "target": "derived_gym_intensity_band",
            "notes": f"3-class gym member exercise intensity from {target_col}.",
        }
    raise ValueError("No numeric columns found")


CONFIGS = [
    BenchmarkConfig("minute_calories_wide_band", "minuteCaloriesWide_merged.csv", _minute_calories_wide_band),
    BenchmarkConfig("minute_steps_wide_band", "minuteStepsWide_merged.csv", _minute_steps_wide_band),
    BenchmarkConfig("minute_intensities_wide_band", "minuteIntensitiesWide_merged.csv", _minute_intensities_wide_band),
    BenchmarkConfig("hourly_intensities_band", "hourlyIntensities_merged.csv", _hourly_intensities_band),
    BenchmarkConfig("minute_mets_band", "minuteMETsNarrow_merged.csv", _minute_mets_band),
    BenchmarkConfig("minute_sleep_band", "minuteSleep_merged.csv", _minute_sleep_band),
    BenchmarkConfig("fitness_workout_level", "fitness_and_workout_dataset.csv", _fitness_workout_level),
    BenchmarkConfig("gym_members_intensity", "gym_members_exercise_tracking.csv", _gym_members_intensity),
]


def run_benchmark() -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for config in CONFIGS:
        path = DATASET_ROOT / config.filename
        if not path.exists():
            result = {
                "dataset_name": config.name,
                "filename": config.filename,
                "status": "error",
                "error": f"File not found",
            }
            results.append(result)
            continue

        try:
            dataset = pd.read_csv(path)
        except Exception as exc:
            result = {
                "dataset_name": config.name,
                "filename": config.filename,
                "status": "error",
                "error": f"Load failed",
            }
            results.append(result)
            continue

        try:
            X, y, metadata = config.prepare(dataset)
        except Exception as exc:
            result = {
                "dataset_name": config.name,
                "filename": config.filename,
                "status": "error",
                "error": f"Prepare failed",
            }
            results.append(result)
            continue

        result = {
            "dataset_name": config.name,
            "filename": config.filename,
            "original_rows": int(len(dataset)),
            "original_columns": int(dataset.shape[1]),
            **metadata,
        }
        try:
            result.update(_train_and_score(X, y))
            result["status"] = "ok"
        except Exception as exc:
            result["status"] = "error"
            result["error"] = str(exc)
        results.append(result)

    payload = {
        "dataset_root": str(DATASET_ROOT),
        "random_state": RANDOM_STATE,
        "benchmarked_datasets": len([r for r in results if r["status"] == "ok"]),
        "results": results,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


if __name__ == "__main__":
    benchmark = run_benchmark()
    print(f"\n{'='*100}")
    print(f"MORE NEW DATASETS TRAINING RESULTS (different from the previous 16)")
    print(f"{'='*100}\n")
    
    table_lines = []
    for item in benchmark["results"]:
        if item["status"] == "ok":
            metrics = item["best_metrics"]
            table_lines.append({
                "Dataset": item["dataset_name"],
                "Accuracy": f"{metrics['accuracy']:.4f}",
                "F1 (Weighted)": f"{metrics['weighted_f1']:.4f}",
                "Best Model": item["best_model"],
                "Rows Used": item["rows_used"],
                "Features": item["feature_count"],
            })
            print(f"[OK] {item['dataset_name']}")
            print(f"  Accuracy: {metrics['accuracy']:.4f} | F1: {metrics['weighted_f1']:.4f} | Best Model: {item['best_model']}")
            print(f"  Rows: {item['rows_used']} | Features: {item['feature_count']}\n")
        else:
            print(f"[ERROR] {item['dataset_name']}")
            print(f"  error: {item.get('error', 'unknown')}\n")
    
    print(f"\n{'='*100}")
    print("TABLE FORMAT:")
    print(f"{'='*100}\n")
    if table_lines:
        import json
        print(json.dumps(table_lines, indent=2))
