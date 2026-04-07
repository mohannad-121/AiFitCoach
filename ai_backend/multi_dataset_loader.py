"""
Multi-Dataset Loader and Indexer

Loads all 50+ datasets and creates indexed collections for:
- Exercises, Fitness Programs, Gym Recommendations
- Food, Nutrition, Diet Recommendations  
- Fitness Profiles, User Progress, Activity Data
- Health Conditions, Disease Impacts, Medical Rules

This enables the AI to train on comprehensive data patterns.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
import logging
from collections import defaultdict

import pandas as pd

logger = logging.getLogger(__name__)


def _safe_float(value: Any, default: float = 0.0) -> float:
    """Safely convert value to float."""
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    """Safely convert value to int."""
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _clean_text(value: Any) -> str:
    """Normalize arbitrary values into trimmed strings."""
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def _first_present(row: dict[str, Any], *keys: str) -> Any:
    """Return the first non-empty value for the provided keys."""
    for key in keys:
        value = row.get(key)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


class MultiDatasetLoader:
    """Loads and indexes all available datasets in the datasets folder."""
    
    def __init__(self, dataset_root: Path):
        self.dataset_root = Path(dataset_root)
        self.datasets: dict[str, list[dict[str, Any]]] = {}
        self.metadata: dict[str, dict[str, Any]] = {}
        self.loaded = False
    
    def load_all(self) -> None:
        """Load and index all datasets."""
        logger.info(f"Starting to load all datasets from {self.dataset_root}")
        
        # Load different dataset categories
        self._load_exercise_datasets()
        self._load_food_nutrition_datasets()
        self._load_activity_datasets()
        self._load_fitness_profile_datasets()
        self._load_health_datasets()
        self._load_recommendation_datasets()
        
        self.loaded = True
        logger.info(f"Loaded {len(self.datasets)} dataset categories with {sum(len(v) for v in self.datasets.values())} total records")
    
    def _load_table(self, filename: str, dataset_name: str, required_fields: list[str] | None = None) -> list[dict[str, Any]]:
        """Load a CSV or Excel file and return normalized row dictionaries."""
        filepath = self.dataset_root / filename
        rows = []
        
        if not filepath.exists():
            logger.debug(f"Dataset not found: {filename}")
            return rows
        
        try:
            suffix = filepath.suffix.lower()
            if suffix == ".xlsx":
                dataframe = pd.read_excel(filepath)
                source_type = "xlsx"
            else:
                dataframe = pd.read_csv(filepath, engine="python", on_bad_lines="skip")
                source_type = "csv"

            dataframe = dataframe.where(pd.notnull(dataframe), None)
            for row in dataframe.to_dict(orient="records"):
                normalized_row = {str(key): value for key, value in row.items()}
                if required_fields and not all(_clean_text(normalized_row.get(field)) for field in required_fields):
                    continue
                rows.append(normalized_row)
            
            logger.info(f"Loaded {len(rows)} records from {filename}")
            self.metadata[dataset_name] = {
                "type": source_type,
                "file": filename,
                "record_count": len(rows),
                "sample_columns": list(rows[0].keys()) if rows else []
            }
        except Exception as e:
            logger.error(f"Error loading {filename}: {e}")
        
        return rows

    def _load_csv(self, filename: str, dataset_name: str, required_fields: list[str] | None = None) -> list[dict[str, Any]]:
        """Backward-compatible wrapper for table loading."""
        return self._load_table(filename, dataset_name, required_fields)

    def _store_dataset(self, dataset_name: str, records: list[dict[str, Any]]) -> None:
        """Append records into an existing dataset bucket."""
        if not records:
            return
        existing = self.datasets.setdefault(dataset_name, [])
        if dataset_name in {"exercises", "foods"}:
            def record_key(record: dict[str, Any]) -> tuple[Any, ...]:
                if dataset_name == "exercises":
                    return (
                        record.get("exercise"),
                        record.get("muscle"),
                        record.get("difficulty"),
                        record.get("equipment"),
                        record.get("type"),
                        record.get("reps"),
                    )
                return (
                    record.get("name"),
                    record.get("category"),
                    record.get("calories"),
                    record.get("protein_g"),
                    record.get("carbs_g"),
                    record.get("fat_g"),
                    record.get("meal_type"),
                )

            seen = {
                record_key(record)
                for record in existing
            }
            for record in records:
                key = record_key(record)
                if key in seen:
                    continue
                seen.add(key)
                existing.append(record)
            return
        existing.extend(records)

    def _normalize_exercise_record(self, row: dict[str, Any]) -> dict[str, Any] | None:
        """Map heterogeneous workout rows into the training exercise schema."""
        exercise_name = _clean_text(
            _first_present(row, "exercise_name", "Title", "Exercise", "title", "Workout_Type", "activity_type")
        )
        if not exercise_name:
            return None

        difficulty_raw = _first_present(row, "Level", "Difficulty", "level", "Experience_Level", "intensity")
        equipment_raw = _first_present(row, "Equipment", "equipment")
        exercise_type = _clean_text(_first_present(row, "Type", "type", "Workout_Type", "activity_type", "goal"))
        description = _clean_text(_first_present(row, "Desc", "Description", "description"))
        if not description:
            title = _clean_text(_first_present(row, "title", "Title"))
            description = title if title and title != exercise_name else ""

        return {
            "exercise": exercise_name,
            "muscle": _clean_text(_first_present(row, "BodyPart", "Body Part", "muscle", "muscle_group")),
            "difficulty": _clean_text(difficulty_raw) or "Beginner",
            "equipment": _clean_text(equipment_raw) or "Bodyweight",
            "type": exercise_type or "Strength",
            "reps": _clean_text(_first_present(row, "Reps", "reps")),
            "description": description,
        }

    def _normalize_food_record(self, row: dict[str, Any]) -> dict[str, Any] | None:
        """Map heterogeneous nutrition rows into the training food schema."""
        food_name = _clean_text(_first_present(row, "Food_Item", "Food", "name", "food_item_type_1", "description"))
        if not food_name:
            return None

        calories = _safe_float(_first_present(row, "Calories (kcal)", "Calories", "total_calories", "calories(kCal)_1"))
        protein = _safe_float(_first_present(row, "Protein (g)", "Protein", "total_protein", "protein(g)_1"))
        carbs = _safe_float(_first_present(row, "Carbohydrates (g)", "Carbs", "total_carbohydrates", "carbohydrates(g)_1"))
        fat = _safe_float(_first_present(row, "Fat (g)", "Fat", "total_fats", "fat(g)_1"))
        fiber = _safe_float(_first_present(row, "Fiber (g)", "Fiber"))

        if calories <= 0 and protein <= 0 and carbs <= 0 and fat <= 0 and fiber <= 0:
            return None

        return {
            "name": food_name,
            "category": _clean_text(_first_present(row, "Category", "Group", "category", "food_category")) or "dish",
            "calories": _safe_int(calories),
            "protein_g": protein,
            "carbs_g": carbs,
            "fat_g": fat,
            "fiber_g": fiber,
            "sugars_g": _safe_float(_first_present(row, "Sugars (g)", "Sugars")),
            "sodium_mg": _safe_float(_first_present(row, "Sodium (mg)", "Sodium", "total_sodium", "sodium(mg)_1")),
            "cholesterol_mg": _safe_float(_first_present(row, "Cholesterol (mg)", "Cholesterol")),
            "meal_type": _clean_text(_first_present(row, "Meal_Type", "Meal Type")) or "any",
        }

    def _load_normalized_records(
        self,
        filename: str,
        dataset_name: str,
        normalizer,
        source_dataset_name: str | None = None,
    ) -> None:
        """Load a table and append normalized records into a target dataset."""
        raw_name = source_dataset_name or Path(filename).stem
        rows = self._load_table(filename, raw_name)
        normalized_records = []
        for row in rows:
            normalized = normalizer(row)
            if normalized:
                normalized_records.append(normalized)
        self._store_dataset(dataset_name, normalized_records)
    
    def _load_exercise_datasets(self) -> None:
        """Load all exercise and gym-related datasets."""
        logger.info("Loading exercise datasets...")

        for filename, source_name in (
            ("megaGymDataset.csv", "exercises_mega_gym"),
            ("programs_detailed_boostcamp_kaggle.csv", "programs_detailed_boostcamp"),
        ):
            self._load_normalized_records(filename, "exercises", self._normalize_exercise_record, source_name)

        for filename, dataset_name in (
            ("fitness_and_workout_dataset.csv", "fitness_programs"),
            ("program_summary.csv", "program_summaries"),
            ("gym recommendation.xlsx", "gym_recommendations"),
        ):
            records = self._load_table(filename, dataset_name)
            self._store_dataset(dataset_name, records)
    
    def _load_food_nutrition_datasets(self) -> None:
        """Load all food and nutrition datasets."""
        logger.info("Loading food and nutrition datasets...")

        for filename, source_name in (
            ("daily_food_nutrition_dataset.csv", "daily_food_nutrition"),
            ("nutritionverse_dish_metadata3.csv", "nutritionverse_dishes"),
        ):
            self._load_normalized_records(filename, "foods", self._normalize_food_record, source_name)

        for filename, dataset_name in (
            ("diet_recommendations_dataset.csv", "diet_recommendations"),
            ("Personalized_Diet_Recommendations.csv", "personalized_diet_recommendations"),
            ("food-allergens.csv", "food_allergens"),
            ("fitness-recommendation-dataset.csv", "fitness_recommendations"),
            ("nutrition.xlsx", "nutrition_patterns"),
        ):
            records = self._load_table(filename, dataset_name)
            self._store_dataset(dataset_name, records)
    
    def _load_activity_datasets(self) -> None:
        """Load all activity tracking datasets."""
        logger.info("Loading activity and tracking datasets...")
        
        activity_files = {
            "dailyActivity_merged.csv": "daily_activity",
            "dailyCalories_merged.csv": "daily_calories",
            "dailyIntensities_merged.csv": "daily_intensities",
            "dailySteps_merged.csv": "daily_steps",
            "hourlyCalories_merged.csv": "hourly_calories",
            "hourlyIntensities_merged.csv": "hourly_intensities",
            "hourlySteps_merged.csv": "hourly_steps",
            "heartrate_seconds_merged.csv": "heart_rate",
            "minuteCaloriesNarrow_merged.csv": "minute_calories_narrow",
            "minuteCaloriesWide_merged.csv": "minute_calories_wide",
            "minuteIntensitiesNarrow_merged.csv": "minute_intensities_narrow",
            "minuteIntensitiesWide_merged.csv": "minute_intensities_wide",
            "minuteMETsNarrow_merged.csv": "minute_mets",
            "minuteSleep_merged.csv": "minute_sleep",
            "minuteStepsNarrow_merged.csv": "minute_steps_narrow",
            "minuteStepsWide_merged.csv": "minute_steps_wide",
            "sleepDay_merged.csv": "sleep_day",
            "weightLogInfo_merged.csv": "weight_log",
            "health_fitness_dataset.csv": "health_fitness_records",
            "gym_members_exercise_tracking.csv": "gym_member_sessions",
            "Gym_Progress_Dataset.csv": "gym_progress",
        }
        
        for filename, dataset_name in activity_files.items():
            data = self._load_table(filename, dataset_name)
            if data:
                self.datasets[dataset_name] = data
    
    def _load_fitness_profile_datasets(self) -> None:
        """Load fitness profile and user datasets."""
        logger.info("Loading fitness profile datasets...")
        
        # Sample data CSVs
        profile_files = {
            "acquisition_samples.csv": "acquisition_samples",
            "agricultural_samples.csv": "agricultural_samples",
        }
        
        for filename, dataset_name in profile_files.items():
            data = self._load_table(filename, dataset_name)
            if data:
                self.datasets[dataset_name] = data
    
    def _load_health_datasets(self) -> None:
        """Load health condition and disease-related datasets."""
        logger.info("Loading health datasets...")
        
        # Food allergy dataset  
        allergy_data = self._load_table("food_allergy_dataset.csv", "food_allergy_detailed")
        if allergy_data:
            self.datasets["food_allergy_detailed"] = allergy_data
    
    def _load_recommendation_datasets(self) -> None:
        """Load recommendation and pattern datasets."""
        logger.info("Loading recommendation datasets...")

        for filename, dataset_name in (
            ("health_fitness_dataset.csv", "health_fitness_patterns"),
            ("gym_members_exercise_tracking.csv", "gym_member_patterns"),
        ):
            records = self._load_table(filename, dataset_name)
            self._store_dataset(dataset_name, records)
    
    def get_dataset(self, name: str) -> list[dict[str, Any]]:
        """Get a specific dataset by name."""
        return self.datasets.get(name, [])
    
    def get_all_datasets(self) -> dict[str, list[dict[str, Any]]]:
        """Get all loaded datasets."""
        return self.datasets
    
    def get_metadata(self) -> dict[str, dict[str, Any]]:
        """Get metadata about all loaded datasets."""
        return self.metadata
    
    def search_datasets(self, query: str, dataset_name: str | None = None) -> dict[str, list[dict[str, Any]]]:
        """
        Search for records matching the query across datasets.
        
        Args:
            query: Search query
            dataset_name: Optional specific dataset to search in
            
        Returns:
            Dictionary of dataset_name -> matching records
        """
        results: dict[str, list[dict[str, Any]]] = {}
        query_lower = query.lower()
        
        datasets_to_search = {dataset_name: self.datasets[dataset_name]} if dataset_name else self.datasets
        
        for name, records in datasets_to_search.items():
            matches = []
            for record in records:
                # Search across all string values in the record
                record_text = " ".join(str(v).lower() for v in record.values())
                if query_lower in record_text:
                    matches.append(record)
            
            if matches:
                results[name] = matches
        
        return results
    
    def get_exercise_patterns(self) -> dict[str, Any]:
        """Extract patterns from exercise datasets for training."""
        patterns = {
            "muscle_groups": defaultdict(int),
            "difficulties": defaultdict(int),
            "equipment": defaultdict(int),
            "exercise_types": defaultdict(int),
        }
        
        exercises = self.datasets.get("exercises", [])
        for ex in exercises:
            patterns["muscle_groups"][ex.get("muscle", "unknown")] += 1
            patterns["difficulties"][ex.get("difficulty", "unknown")] += 1
            patterns["equipment"][ex.get("equipment", "unknown")] += 1
            patterns["exercise_types"][ex.get("type", "unknown")] += 1
        
        return {k: dict(v) for k, v in patterns.items()}
    
    def get_nutrition_patterns(self) -> dict[str, Any]:
        """Extract patterns from nutrition datasets for training."""
        patterns = {
            "food_categories": defaultdict(int),
            "macro_ranges": {
                "protein_high": 0,
                "carbs_high": 0,
                "fat_high": 0,
                "low_calorie": 0,
            },
            "avg_macros": {
                "protein_g": 0,
                "carbs_g": 0,
                "fat_g": 0,
                "calories": 0,
            }
        }
        
        foods = self.datasets.get("foods", [])
        macro_counts = {"protein_g": 0, "carbs_g": 0, "fat_g": 0, "calories": 0}
        
        for food in foods:
            patterns["food_categories"][food.get("category", "unknown")] += 1
            
            # Count high-macro foods
            if food.get("protein_g", 0) > 20:
                patterns["macro_ranges"]["protein_high"] += 1
            if food.get("carbs_g", 0) > 40:
                patterns["macro_ranges"]["carbs_high"] += 1
            if food.get("fat_g", 0) > 15:
                patterns["macro_ranges"]["fat_high"] += 1
            if food.get("calories", 0) < 100:
                patterns["macro_ranges"]["low_calorie"] += 1
            
            # Accumulate for averages
            if food.get("protein_g"):
                macro_counts["protein_g"] += food["protein_g"]
            if food.get("carbs_g"):
                macro_counts["carbs_g"] += food["carbs_g"]
            if food.get("fat_g"):
                macro_counts["fat_g"] += food["fat_g"]
            if food.get("calories"):
                macro_counts["calories"] += food["calories"]
        
        # Calculate averages
        if foods:
            for macro, total in macro_counts.items():
                patterns["avg_macros"][macro] = round(total / len(foods), 2)
        
        return patterns


if __name__ == "__main__":
    # Example usage
    import sys
    from dataset_paths import resolve_dataset_root
    
    root = resolve_dataset_root()
    loader = MultiDatasetLoader(root)
    loader.load_all()
    
    print("\n=== Loaded Datasets ===")
    for name, records in loader.get_all_datasets().items():
        print(f"{name}: {len(records)} records")
    
    print("\n=== Exercise Patterns ===")
    ex_patterns = loader.get_exercise_patterns()
    print(json.dumps(ex_patterns, indent=2))
    
    print("\n=== Nutrition Patterns ===")
    nut_patterns = loader.get_nutrition_patterns()
    print(json.dumps(nut_patterns, indent=2))
