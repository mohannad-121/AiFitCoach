"""
Train the OTHER datasets (not the 6 already benchmarked).
Focuses on the 7th config (gym_progress_weight_trend) and additional suitable datasets.
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
from sklearn.metrics import accuracy_score, f1_score, classification_report
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


DATASET_ROOT = Path(__file__).resolve().parent / "datasets"
OUTPUT_PATH = Path(__file__).resolve().parent / "data" / "derived" / "other_datasets_benchmark.json"
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
                        n_estimators=300,
                        random_state=RANDOM_STATE,
                        class_weight="balanced_subsample",
                        n_jobs=-1,
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
            "macro_f1": float(f1_score(y_test, predictions, average="macro")),
            "report": classification_report(y_test, predictions, output_dict=True, zero_division=0),
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


# THE 7TH DATASET (not trained in the original limit=6)
def _gym_progress_weight_trend(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    work = df.copy()
    work["Day"] = pd.to_datetime(work["Day"], errors="coerce")
    work = work.sort_values("Day").reset_index(drop=True)
    work["next_weight_change"] = work["Weight_kg"].shift(-1) - work["Weight_kg"]
    target = pd.cut(
        work["next_weight_change"],
        bins=[-np.inf, -0.5, 0.5, np.inf],
        labels=["loss", "stable", "gain"],
    )
    feature_columns = ["Calories_Intake", "Protein_Intake_g", "Workout_Duration_min", "Steps_Walked"]
    return work[feature_columns], pd.Series(target, name="weight_trend"), {
        "target": "derived_next_day_weight_trend",
        "notes": "Predict next-day weight trend from intake, protein, training duration, and steps.",
    }


# ADDITIONAL DATASETS
def _health_fitness_bmi_band(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """BMI classification from health and fitness data."""
    work = df.copy()
    if "BMI" in work.columns:
        bmi_band = _quantile_target(work["BMI"])
        feature_columns = [col for col in work.columns if col not in {"BMI"}][:20]  # Limit to 20 features
        return work[feature_columns], pd.Series(bmi_band, name="bmi_band"), {
            "target": "derived_bmi_band",
            "notes": "3-class BMI band (low/medium/high) from health and fitness metrics.",
        }
    raise ValueError("BMI column not found")


def _weight_log_trend(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """Weight trend from weight log data."""
    work = df.copy()
    work["Date"] = pd.to_datetime(work["Date"], errors="coerce")
    work = work.sort_values("Date").reset_index(drop=True)
    if "WeightPounds" in work.columns:
        work["weight_change"] = work["WeightPounds"].diff()
        target = pd.cut(
            work["weight_change"],
            bins=[-np.inf, -0.5, 0.5, np.inf],
            labels=["loss", "stable", "gain"],
        )
        feature_columns = [col for col in work.columns if col not in {"WeightPounds", "Date", "Weight_kg", "Fat"}]
        if feature_columns:
            return work[feature_columns], pd.Series(target, name="weight_trend"), {
                "target": "derived_weight_change_trend",
                "notes": "Weight change direction from logged weight metrics.",
            }
    raise ValueError("WeightPounds column not found")


def _hourly_calories_band(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """Hourly calorie band from hourly data."""
    work = df.copy()
    if "Calories" in work.columns:
        calorie_band = _quantile_target(work["Calories"])
        feature_columns = [col for col in work.columns if col != "Calories"]
        return work[feature_columns], pd.Series(calorie_band, name="hourly_calorie_band"), {
            "target": "derived_hourly_calorie_band",
            "notes": "3-class hourly calorie band from hourly activity data.",
        }
    raise ValueError("Calories column not found")


def _sleep_quality_band(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """Sleep quality band."""
    work = df.copy()
    if "TotalMinutesAsleep" in work.columns:
        sleep_band = _quantile_target(work["TotalMinutesAsleep"])
        feature_columns = [col for col in work.columns if col not in {"TotalMinutesAsleep", "TotalTimeInBed", "SleepDay"}]
        if feature_columns:
            return work[feature_columns], pd.Series(sleep_band, name="sleep_quality_band"), {
                "target": "derived_sleep_quality_band",
                "notes": "3-class sleep quality band from sleep metrics.",
            }
    raise ValueError("TotalMinutesAsleep column not found")


def _megagym_exercise_performance(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    """Exercise performance level."""
    work = df.copy()
    # Find numeric columns for target
    numeric_cols = work.select_dtypes(include=[np.number]).columns.tolist()
    if numeric_cols:
        target_col = numeric_cols[0]
        perf_band = _quantile_target(work[target_col])
        feature_columns = [col for col in work.columns if col != target_col][:30]  # Limit features
        return work[feature_columns], pd.Series(perf_band, name="performance_band"), {
            "target": "derived_performance_band",
            "notes": f"3-class performance band derived from {target_col}.",
        }
    raise ValueError("No numeric columns found")


CONFIGS = [
    BenchmarkConfig("gym_progress_weight_trend", "Gym_Progress_Dataset.csv", _gym_progress_weight_trend),
    BenchmarkConfig("health_fitness_bmi_band", "health_fitness_dataset.csv", _health_fitness_bmi_band),
    BenchmarkConfig("weight_log_trend", "weightLogInfo_merged.csv", _weight_log_trend),
    BenchmarkConfig("hourly_calories_band", "hourlyCalories_merged.csv", _hourly_calories_band),
    BenchmarkConfig("sleep_quality_band", "sleepDay_merged.csv", _sleep_quality_band),
    BenchmarkConfig("megagym_exercise_performance", "megaGymDataset.csv", _megagym_exercise_performance),
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
                "error": f"File not found: {config.filename}",
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
                "error": f"Failed to load CSV: {str(exc)}",
            }
            results.append(result)
            continue

        try:
            X, y, metadata = config.prepare(dataset)
        except Exception as exc:
            result = {
                "dataset_name": config.name,
                "filename": config.filename,
                "original_rows": int(len(dataset)),
                "original_columns": int(dataset.shape[1]),
                "status": "error",
                "error": f"Prepare failed: {str(exc)}",
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
    print(f"\n{'='*80}")
    print(f"OTHER DATASETS TRAINING RESULTS (not the original 6)")
    print(f"{'='*80}\n")
    
    for item in benchmark["results"]:
        print(f"[{item['status'].upper()}] {item['dataset_name']}")
        if item["status"] != "ok":
            print(f"  error: {item.get('error', 'unknown')}\n")
            continue
        metrics = item["best_metrics"]
        print(f"  File: {item['filename']}")
        print(f"  Rows: {item['rows_used']} | Features: {item['feature_count']} | Classes: {item['class_count']}")
        print(
            f"  >>> ACCURACY: {metrics['accuracy']:.4f} | F1 (weighted): {metrics['weighted_f1']:.4f} | Baseline: {item['baseline_accuracy']:.4f}"
        )
        print(f"  Best Model: {item['best_model']}\n")
