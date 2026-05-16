from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


DATASET_ROOT = Path(__file__).resolve().parent / "datasets"
OUTPUT_PATH = Path(__file__).resolve().parent / "data" / "derived" / "untrained_dataset_benchmark.json"
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


def _fitness_recommendation_goal(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    feature_columns = ["Sex", "Age", "Height", "Weight", "Hypertension", "Diabetes", "BMI", "Level"]
    work = df[feature_columns + ["Fitness Goal"]].copy()
    return work[feature_columns], work["Fitness Goal"].astype(str).str.strip(), {
        "target": "Fitness Goal",
        "notes": "Predict the stated fitness goal from profile and health features.",
    }


def _personalized_diet_meal_plan(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    target = "Recommended_Meal_Plan"
    feature_columns = [
        column
        for column in df.columns
        if column not in {"Patient_ID", target}
        and not column.startswith("Recommended_")
    ]
    work = df[feature_columns + [target]].copy()
    return work[feature_columns], work[target].astype(str).str.strip(), {
        "target": target,
        "notes": "Predict meal-plan class from patient profile, vitals, habits, and intake features.",
    }


def _diet_recommendation_label(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    target = "Diet_Recommendation"
    feature_columns = [column for column in df.columns if column not in {"Patient_ID", target}]
    work = df[feature_columns + [target]].copy()
    return work[feature_columns], work[target].astype(str).str.strip(), {
        "target": target,
        "notes": "Predict recommended diet class from patient health and lifestyle fields.",
    }


def _food_allergy_binary(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    target = "Allergic"
    feature_columns = [column for column in df.columns if column != target]
    work = df[feature_columns + [target]].copy()
    work[target] = pd.to_numeric(work[target], errors="coerce")
    return work[feature_columns], work[target].astype("Int64"), {
        "target": target,
        "notes": "Binary allergy risk classification from symptoms, history, and biomarker features.",
    }


def _daily_activity_calorie_band(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    work = df.copy()
    work["ActivityDate"] = pd.to_datetime(work["ActivityDate"], errors="coerce")
    work["weekday"] = work["ActivityDate"].dt.dayofweek
    calorie_band = _quantile_target(work["Calories"])
    feature_columns = [column for column in work.columns if column not in {"Calories", "ActivityDate"}]
    return work[feature_columns], pd.Series(calorie_band, name="calorie_band"), {
        "target": "derived_calorie_band",
        "notes": "3-class calorie-burn band predicted from steps, distances, active minutes, and weekday.",
    }


def _minute_intensity_second_half_band(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    work = df.copy()
    work["ActivityHour"] = pd.to_datetime(work["ActivityHour"], errors="coerce")
    work["hour_of_day"] = work["ActivityHour"].dt.hour
    first_half = [f"Intensity{index:02d}" for index in range(30)]
    second_half = [f"Intensity{index:02d}" for index in range(30, 60)]
    work["second_half_total"] = work[second_half].sum(axis=1)
    target = _quantile_target(work["second_half_total"])
    feature_columns = ["Id", "hour_of_day", *first_half]
    return work[feature_columns], pd.Series(target, name="second_half_band"), {
        "target": "derived_second_half_intensity_band",
        "notes": "Forecast the next 30-minute intensity band from the first 30 minutes of the hour.",
    }


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


CONFIGS = [
    BenchmarkConfig("fitness_recommendation_goal", "fitness-recommendation-dataset.csv", _fitness_recommendation_goal),
    BenchmarkConfig("personalized_diet_meal_plan", "Personalized_Diet_Recommendations.csv", _personalized_diet_meal_plan),
    BenchmarkConfig("diet_recommendation_label", "diet_recommendations_dataset.csv", _diet_recommendation_label),
    BenchmarkConfig("food_allergy_binary", "food_allergy_dataset.csv", _food_allergy_binary),
    BenchmarkConfig("daily_activity_calorie_band", "dailyActivity_merged.csv", _daily_activity_calorie_band),
    BenchmarkConfig("minute_intensity_second_half_band", "minuteIntensitiesWide_merged.csv", _minute_intensity_second_half_band),
    BenchmarkConfig("gym_progress_weight_trend", "Gym_Progress_Dataset.csv", _gym_progress_weight_trend),
]


def run_benchmark(limit: int = 6) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for config in CONFIGS[:limit]:
        path = DATASET_ROOT / config.filename
        dataset = pd.read_csv(path)
        X, y, metadata = config.prepare(dataset)
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
        "benchmarked_datasets": len(results),
        "results": results,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


if __name__ == "__main__":
    benchmark = run_benchmark(limit=6)
    for item in benchmark["results"]:
        print(f"[{item['status']}] {item['dataset_name']} -> {item.get('best_model', 'n/a')}")
        if item["status"] != "ok":
            print(f"  error: {item.get('error')}")
            continue
        metrics = item["best_metrics"]
        print(
            "  rows_used={rows} features={features} classes={classes} accuracy={accuracy:.4f} weighted_f1={weighted_f1:.4f} baseline={baseline:.4f}".format(
                rows=item["rows_used"],
                features=item["feature_count"],
                classes=item["class_count"],
                accuracy=metrics["accuracy"],
                weighted_f1=metrics["weighted_f1"],
                baseline=item["baseline_accuracy"],
            )
        )