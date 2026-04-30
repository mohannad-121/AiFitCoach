# FitCoach AI: A Hybrid AI System for Personalized Fitness Coaching Using AI Models

## Graduation Project Documentation

### Students

Mohannad Ahmad Abuayyash — 20222671  
Moayad Abdul-Jawad Rabah — 20224378  
Farah Ahmad Almallah — 20224859  
Batool Tareq — 20220331  
Shahed Jamal Othman — 20220329  

### Supervisor

Dr. Ahmad Abu Rumman

---

## Abstract

This project presents FitCoach AI, a hybrid intelligent fitness coaching platform that combines machine learning, retrieval-augmented generation, deterministic validation logic, and large language models to deliver personalized workout and nutrition guidance. The goal of the project was not to build a simple chatbot, but to build a practical AI system that can understand user goals, use structured health and fitness data, retrieve evidence from curated datasets, and generate recommendations that are safer, more relevant, and easier to follow.

During development, we moved through several stages. In the beginning, the system relied more on static rules and dataset-driven responses. As the project grew, we introduced supervised models for goal prediction, plan-intent detection, success estimation, and conversation-intent classification. We also added semantic retrieval using sentence-transformer embeddings and FAISS, and later supported both OpenAI and Ollama-based LLM providers to improve flexibility, cost control, and deployment independence. The final result is a bilingual web platform built with React and FastAPI that supports chat, plan generation, schedule management, progress analysis, health-aware recommendations, file attachments, and Arabic/English interaction.

This documentation explains the whole journey of the project, including the motivation behind the architecture, the models we used, the algorithms we selected, why some models and providers changed over time, the datasets and training pipeline we relied on, and the most important technical challenges we solved.

## 1. Introduction

Fitness applications are everywhere, but many of them still provide generic plans that do not truly adapt to the user. A beginner and an advanced trainee often receive recommendations that are too similar. Users with fat-loss goals, muscle-gain goals, injuries, limited equipment, or inconsistent attendance are usually not treated as different cases in a meaningful way. Even when some applications add a chat feature, the result is often just a thin wrapper around a language model with no real connection to structured data or safety rules.

The idea behind FitCoach AI was to solve this gap by designing a system that behaves more like an intelligent coaching assistant than a static app. We wanted the system to understand the user profile, estimate the user goal, retrieve knowledge from curated fitness and nutrition datasets, generate several candidate plans, validate them with explicit rules, and then allow the user to approve and schedule the best option. This approach reflects how a real coach thinks: first understand the client, then analyze the situation, then choose the most suitable plan instead of giving the same answer to everyone.

From the academic side, the project was also designed to demonstrate that AI in applied systems is stronger when several methods work together. Instead of depending on one model only, we built a hybrid pipeline where traditional machine learning, retrieval, rule-based validation, and LLM-based generation each play a clear role.

## 2. Literature Review / Related Work

Recent work in AI-supported fitness and wellness systems shows a clear evolution from static guidance tools toward more adaptive and conversational systems. However, this evolution has not removed the core tradeoff between control and flexibility. Systems that are highly structured are usually more predictable but less personalized, while systems that are highly conversational are often more engaging but less reliable. In reviewing related projects and common architectural patterns, we found that most solutions fall into four broad categories. The first category contains traditional fitness applications built around fixed workout libraries, BMI or calorie calculators, and manually selected plans. The second includes recommender-style systems that use structured profile data to suggest exercises, foods, or health actions. The third covers chatbot-oriented wellness assistants powered mainly by large language models. The fourth, which is the most recent and technically ambitious category, includes hybrid systems that combine retrieval, predictive models, and generation. Our project belongs to this last category because the problem we addressed required both data-driven structure and natural interaction.

### 2.1 Summary of Previous Research and Projects

Previous research and practical systems in this area usually emphasize one main design philosophy rather than a balanced combination of methods. One common direction is expert-defined or rule-based recommendation, where a system selects workout or diet suggestions from handcrafted logic using inputs such as age, body measurements, target goal, and activity level. This approach is attractive because it is transparent and easy to validate, especially in health-related contexts. Its weakness appears when the user profile becomes more nuanced, for example when motivation, adherence history, equipment limitations, or mixed goals need to be considered together.

Another direction uses classical machine learning to predict categories such as obesity level, health risk, plan preference, or expected success. These systems are valuable because they learn patterns from data rather than relying only on manual assumptions. They are also efficient and explainable enough for many applied projects. Still, many such systems stop at the prediction stage and then depend on fixed post-processing rules. As a result, they classify users well but do not provide a rich coaching experience, iterative explanation, or interactive adaptation after the user responds.

The third major direction uses large language models as the center of the experience. These systems are often stronger in communication quality, explanation, and user engagement. They can answer open-ended questions, respond to follow-up requests, and maintain a more natural conversational tone. However, when they are used without retrieval or explicit validation, they may generate generic recommendations, repeat common advice, or produce plans that are not well aligned with the user profile.

Related graduation projects and product-level prototypes show the same pattern. Some focus only on workout recommendation, others mainly handle calorie estimation or habit tracking, and some add chat as a presentation layer without connecting it to persistent profile data, scheduling, or progress logic. This fragmentation was important in shaping our own design choice. We did not want a system that could only recommend, only predict, or only chat. We wanted a system that could connect these capabilities in one usable workflow.

### 2.2 Comparative Analysis of Approaches and Tools

When we compared the main approaches, it became clear that each one solves a different part of the coaching problem and fails on another part.

Rule-based systems are strong in predictability, safety enforcement, and debugging clarity. They are particularly useful when hard boundaries are required, for example when filtering unsafe plans or keeping recommendations inside a specific domain. Their limitation is that they do not scale gracefully when requests become multilingual, conversational, or dependent on many interacting user variables.

Classical machine learning is effective for structured prediction tasks. It is well suited to estimating goals, detecting intent, and identifying adherence-related patterns from tabular or text-derived features. It is also computationally practical for a graduation project because training and inference remain efficient. However, prediction alone does not create a convincing coaching experience. A classifier can decide which category a user belongs to, but it cannot by itself conduct a natural dialogue or justify a full plan in a user-friendly way.

Pure LLM-based systems are strong in flexibility, explanation quality, and conversational fluency. They can summarize, rephrase, personalize tone, and answer follow-up questions in a way that feels natural to the user. Their weakness appears when the task demands repeatable structure, grounded domain evidence, or deterministic constraints. In those cases, the system needs support from retrieval and rule validation rather than free-form generation alone.

Retrieval-augmented generation improves on pure LLM systems by introducing external context before the response is produced. This improves grounding and reduces the chance of unsupported advice, especially in data-heavy domains such as exercise selection, nutrition guidance, and user-specific history. Even so, retrieval by itself is not enough if the system still lacks validation rules or predictive signals that distinguish between different user situations.

At the tool level, we selected technologies that matched the role each component had to play. React and FastAPI gave us a practical full-stack foundation. Scikit-learn was appropriate for lightweight, explainable, and fast prediction models. SentenceTransformers with FAISS made semantic retrieval feasible across a large and diverse knowledge base. OpenAI and Ollama support gave the project deployment flexibility by allowing the same architecture to work with either hosted or local language models. The choice of tools was therefore not arbitrary; it followed the architecture we wanted to prove.

### 2.3 Gaps Identified in Current Solutions

From this review, several consistent gaps became clear.

1. Many systems are either structured or conversational, but not both.
2. Many fitness chatbots can speak naturally, but they do not validate what they recommend.
3. Many recommendation systems ignore follow-up interaction and cannot adjust naturally after user feedback.
4. Arabic support is often weak, especially when user intent is short, ambiguous, or mixed with English.
5. Existing systems often lack a full loop from plan suggestion to approval, scheduling, and progress tracking.
6. Deployment flexibility is often limited, with many systems depending on a single external API provider.

Taken together, these gaps show that the main weakness in current solutions is not the absence of AI, but the absence of integration. Many systems have one strong capability, yet very few connect prediction, retrieval, generation, validation, and user follow-up into a single continuous workflow. This observation directly influenced the architecture of FitCoach AI.

### 2.4 Justification for the Chosen Approach

Based on these findings, a hybrid AI architecture was the most defensible choice for our project. The system needed both structured intelligence and natural interaction, and no single approach was strong enough to satisfy both requirements on its own.

We used supervised models where classification and prediction were the right tools, particularly for goal prediction, conversation intent, plan intent, and success estimation. We used retrieval where domain grounding mattered, especially for exercises, foods, user-specific context, and document snippets. We used deterministic rules where safety and consistency could not be left to probability alone, especially in plan validation and recommendation control. Finally, we used large language models where explanation quality, bilingual interaction, and flexible dialogue were essential.

This approach gave us a more balanced and academically defensible system than any single-method design. Instead of forcing one model to solve every problem, we assigned each method to the task it handles best. That decision improved reliability, interpretability, and user experience at the same time. For that reason, FitCoach AI is better described as a hybrid AI coaching platform than as a chatbot or a simple recommendation engine.

## 3. Problem Statement

The central problem of the project was how to build a personalized fitness coaching system that is both intelligent and practical. A pure rule-based system is stable, but too rigid. A pure LLM system is flexible, but it may hallucinate, ignore constraints, or give different answers for the same situation without a good reason. A real-world coaching system needs a middle ground.

We defined the main problems as follows:

1. Users need workout and nutrition guidance that reflects their personal profile, not general advice.
2. Chat requests can be short, ambiguous, multilingual, or mixed between workout and nutrition intent.
3. Generated plans must remain within safe and realistic limits, especially when health conditions or inconsistent adherence are involved.
4. The system should explain its decisions in a natural way, but those decisions should still be grounded in data.
5. The architecture should remain deployable in more than one environment, including paid cloud APIs and local model hosting.

## 4. Project Objectives

The primary objective of FitCoach AI was to design and implement a hybrid AI fitness coach that can generate personalized plans and provide ongoing support through an interactive platform.

The technical objectives were:

1. Build a web platform that combines profile management, chat, scheduling, and progress tracking.
2. Train machine learning models that support goal classification, conversation understanding, success estimation, and plan-intent routing.
3. Build a retrieval layer that can ground answers and plan generation in actual workout and nutrition datasets.
4. Integrate a large language model in a controlled way rather than using it blindly.
5. Add deterministic validation rules so unsafe or low-quality plans can be filtered before the user approves them.
6. Support both English and Arabic, including Arabic Fusha and Jordanian-style conversation.

## 5. General Project Journey

The development of the project did not happen in one step. It evolved gradually as we understood what worked and what failed.

At the beginning, the system was closer to a dataset-based assistant. It could answer some training and nutrition questions using stored patterns and domain-specific rules, but its responses were still limited. This approach helped us establish a stable foundation and made it easier to guarantee that the system stayed inside the fitness domain.

The second stage focused on making the system more conversational. We noticed that users do not always ask clean technical questions such as “give me a workout plan” or “calculate my calories.” They use greetings, short phrases, incomplete thoughts, Arabic slang, mixed-language text, and follow-up questions. To handle this, we improved the conversation flow and added a conversation-intent model trained on the project’s bilingual intent dataset.

The third stage focused on true personalization. We added feature engineering and supervised models that could infer the user’s likely goal and estimate adherence-related outcomes. This made the recommendations more structured and gave the system a way to combine user profile data with learned patterns instead of relying only on prompts.

The fourth stage introduced retrieval-augmented generation. At this point we wanted the LLM to answer more naturally, but we did not want it to invent exercises, meal suggestions, or unsupported health advice. So we attached a retrieval pipeline that searches relevant exercise, food, and user-context data before the language model produces its answer.

The fifth stage focused on safety, schedule integration, Arabic support, and richer interactions. We added validation logic, plan approval flows, persistent schedule management, progress analysis, attachment understanding through OCR and image handling, and support for local LLM hosting through Ollama. This final stage transformed the project from a promising prototype into a more complete hybrid AI platform.

## 6. Final System Overview

FitCoach AI is a full-stack system with a React frontend and a FastAPI backend. The frontend is responsible for user interaction, profile onboarding, plan browsing, scheduling, and chat. The backend handles the AI pipeline, prediction models, retrieval, moderation, plan generation, validation, and storage.

The project includes several major capabilities:

1. User onboarding and profile collection.
2. AI chat with bilingual responses.
3. Workout and nutrition plan generation.
4. Plan approval and schedule storage.
5. Progress tracking and adherence analysis.
6. Health-aware and goal-aware recommendation logic.
7. Attachment handling for images and PDF files.
8. Support for cloud and local LLM providers.

The core principle behind the final architecture is separation of responsibilities. We did not let one model do everything. Instead, each component solves a narrower problem, and the final system emerges from how those components work together.

## 7. Technical Architecture

The frontend is built with React, TypeScript, Vite, Tailwind, and a modern UI stack. Important pages include the Coach page for chat, the Schedule page for active plan management and completion tracking, the Profile page for user data, and onboarding flows that gather the information used by the backend models.

The backend is built on FastAPI and is centered around the main AI orchestration file in the `ai_backend` folder. Around this core, the project contains specialized modules for recommendation generation, prediction, data loading, retrieval, memory, moderation, and health rule evaluation.

The most important backend modules are:

1. `main.py` as the main orchestration layer and API entry point.
2. `llm_client.py` for provider abstraction between OpenAI and Ollama.
3. `predict.py` for loading and running trained scikit-learn artifacts.
4. `preprocess.py` for feature engineering and training-data normalization.
5. `train_goal_model.py`, `train_success_model.py`, `train_plan_intent_model.py`, and `train_conversation_intent_model.py` for training the supervised models.
6. `persistent_rag_store.py` and related retrieval modules for semantic search and context grounding.
7. `ai_engine.py` for lexical and semantic exercise retrieval.
8. `recommendation_engine.py` and supporting modules for plan generation.
9. `attachment_processing.py` for OCR, image processing, PDF extraction, and attachment summarization.

## 8. Why We Chose a Hybrid AI Design

One of the earliest design decisions in the project was that the system should be hybrid rather than purely generative. We made this decision for three reasons.

First, fitness planning involves constraints. A plan must match the user goal, training level, equipment, possible health restrictions, and practical schedule. A pure LLM can write fluent text, but it does not guarantee consistency from one answer to the next.

Second, user requests are not all the same type. Some messages ask for a plan, some ask for analysis, some are small talk, and some are about the application itself. A single prompt is not enough to cleanly route all of those cases.

Third, we wanted the system to be explainable in a graduation-project context. Traditional machine learning, retrieval, and deterministic rules are easier to justify academically because each component has a clear role and measurable behavior.

For that reason, our final architecture combines:

1. Traditional supervised ML for prediction and routing tasks.
2. Retrieval for evidence grounding.
3. Rule-based validation for safety and consistency.
4. LLM generation for flexible, natural, human-readable responses.

## 9. Data Sources and Dataset Strategy

The project uses a large set of fitness, exercise, food, attendance, and activity datasets. The repository includes exercise datasets, nutrition and food-category datasets, health and fitness records, Fitbit-style activity data, and conversation-intent examples. The multi-dataset training layer was introduced because one small dataset could not cover the full range of workout, nutrition, and user behavior patterns we wanted the system to learn from.

The dataset strategy followed three ideas:

1. Use multiple data sources instead of a single source, because fitness is naturally multi-domain.
2. Normalize different schemas into a shared feature representation.
3. Keep track of the training pipeline so models can be retrained when new datasets are added.

This is why modules such as `dataset_paths.py`, `multi_dataset_loader.py`, `preprocess.py`, and the training scripts became important. They made the data pipeline reproducible instead of ad hoc.

## 10. AI Models Used in the Project

The final project uses several AI and ML models, each for a specific responsibility.

### 9.1 Goal Prediction Model

The goal prediction model predicts the likely fitness goal of the user from structured profile features. It uses engineered features such as age, gender, weight, height, BMI, body-fat related information, workout frequency, experience level, calories burned, and average heart rate.

During training, we compared two main candidate algorithms:

1. Logistic Regression.
2. Random Forest.

The saved production artifact selected `RandomForestClassifier` as the final model. This choice makes sense because user fitness goals are not determined by one straight-line relationship. A random forest can capture non-linear interactions between variables more naturally than a simple linear model. For example, the same BMI can mean different things depending on workout frequency or body-fat percentage.

The current saved artifact reports the following:

- Final model: Random Forest.
- Accuracy: 0.999978.
- Weighted F1: 0.999978.
- Dataset rows: 688,692.

These numbers are very high, but they should be interpreted carefully. In this project, part of the label generation for training was derived through structured heuristics inside the preprocessing pipeline. That means the model performs very well on the representation it was trained on, but the true value of the model in the product is not only the metric. Its real value is that it gives the system a consistent starting point for personalization.

### 9.2 Success Prediction Model

The success prediction model estimates adherence-related outcomes. It uses features such as age, gender, membership type, workout type, workout duration, calories burned, and check-in hour.

Again, we evaluated both Logistic Regression and Random Forest, and the saved artifact selected `RandomForestClassifier`.

Why did we use it? Because plan quality is not only about what is theoretically best. It is also about what the user is likely to follow. A system that only gives the most intense plan can fail if the user has poor adherence. The success model was added to give the system a second dimension: suitability from a compliance point of view.

The current saved artifact reports:

- Final model: Random Forest.
- Accuracy: 1.000000.
- Weighted F1: 1.000000.
- Dataset rows: 20.

Here the documentation must be honest: these numbers look perfect, but the dataset is very small. So we treated this model as a supporting signal, not as the sole authority for planning decisions. That is one example of why the hybrid design matters. When a model has a narrow dataset, the rest of the system can still stabilize the final behavior.

### 9.3 Plan-Intent Classification Model

This model is responsible for deciding whether the user message is asking for a workout plan or a nutrition plan. This became necessary because real user requests are short, messy, multilingual, and sometimes ambiguous. A user may say “I need a cutting plan” or use Arabic slang that does not explicitly include the word “nutrition.”

For this model, we did not use tree models. We used text-classification pipelines built with `TfidfVectorizer` and compared:

1. Character-level Logistic Regression.
2. Character-level Linear SVC.

The saved artifact selected `char_svc`, which is a character-based Support Vector Classifier. This was a strong choice for short bilingual text because character n-grams are robust against spelling variation, Arabic normalization issues, mixed script, and short expressions.

The saved artifact reports:

- Final model: Character SVC.
- Accuracy: 0.964194.
- Weighted F1: 0.964197.
- Dataset rows: 1,952.

This model became especially important after we discovered that heuristic keywords alone were not enough. Later in the project, we still kept heuristics around it, but the ML model gave the routing layer much better behavior than a pure keyword list.

### 9.4 Conversation-Intent Classification Model

The conversation-intent model classifies general chat intent, such as greeting, gratitude, exercise questions, nutrition questions, weight-loss questions, and other supported categories. This model was added because a coaching assistant needs to handle conversation flow, not just plans.

For this task, we compared several text pipelines built from word-level and character-level TF-IDF representations, including Logistic Regression and Linear SVC. The saved artifact selected `word_char_logistic_regression`, which combines word and character features before classification.

This was a practical choice. Word features help the model understand explicit meaning, while character features help with misspellings, Arabic variants, and short informal expressions.

The saved artifact reports:

- Final model: Word + Character Logistic Regression.
- Accuracy: 0.762350.
- Weighted F1: 0.761554.
- Dataset rows: 3,741.

These numbers are more modest than the goal and plan-intent models, but they are realistic for a multi-class conversational task. More importantly, this model improved the naturalness of the assistant and reduced the number of awkward fallback responses.

### 9.5 Embedding Models for Retrieval

The project uses sentence-transformer embedding models in two places.

The first is `all-MiniLM-L6-v2` in `ai_engine.py`, which supports semantic exercise retrieval. This model is compact and fast, which made it suitable for exercise search where low latency matters.

The second is `paraphrase-multilingual-MiniLM-L12-v2` in the persistent RAG store. We selected this model because the project is bilingual, and retrieval needed to work in both English and Arabic. Without multilingual embeddings, the Arabic side of the system would have been much weaker.

### 9.6 Large Language Models

The project uses large language models for generation, explanation, and attachment interpretation. The backend supports both OpenAI and Ollama providers through a single abstraction layer.

At the configuration level, the system originally used OpenAI `gpt-4o` as the default model because it offered strong general reasoning, fast prototyping, and convenient vision support. Later, Ollama support was added to enable local or VM-hosted inference and reduce dependence on paid cloud APIs. Over time, the project configuration also moved through models such as `qwen3:8b` and later `gpt-oss:120b-cloud` on the Ollama side.

This change was not random. We changed providers and models for practical reasons:

1. Cost control.
2. Local deployment flexibility.
3. Better privacy for some deployments.
4. Ability to keep the system running even without an external API key.
5. Better control over vision and chat model separation.

In the final backend design, provider selection is automatic in “auto” mode: if an OpenAI key is available, the system can use OpenAI; otherwise it falls back to Ollama.

## 11. Algorithms and Methods Used

The project uses more than one algorithmic family.

### 10.1 Random Forest

Random forest was used for the goal and success prediction tasks. We chose it because it handles mixed structured features well, captures non-linear interactions, and performs reliably without requiring aggressive feature scaling or deep tuning.

### 10.2 Logistic Regression

Logistic regression was used as a baseline and as part of the final conversation-intent pipeline. It is a strong baseline for text classification when paired with TF-IDF, and it is easy to interpret and train.

### 10.3 Linear Support Vector Classification

Linear SVC was used in the plan-intent training candidates and became the final selected model there. Its strength is high-quality margin-based classification for sparse text vectors, especially for short user requests.

### 10.4 TF-IDF Vectorization

TF-IDF was used for the text models because the routing and intent tasks depend strongly on language patterns. We used both word-level and character-level TF-IDF. Character n-grams were especially useful in Arabic and short messages because they are more tolerant of spelling variation.

### 10.5 Sentence Embeddings

Sentence embeddings were used for semantic retrieval in both exercise search and persistent RAG. This allowed the system to retrieve relevant content even when the user did not use the exact same keywords as the dataset.

### 10.6 FAISS Similarity Search

FAISS was used to store and query vector indexes for the persistent RAG layer. This made semantic search fast enough to be used as part of the interactive request pipeline.

### 10.7 Lexical Fallback Search

We intentionally kept lexical fallback logic in the system. This was important because semantic models are powerful but not infallible. When embeddings are unavailable or when a lexical match is more trustworthy, the system can still return useful results.

### 10.8 OCR and Attachment Processing

The project also includes attachment analysis using `PyMuPDF`, `pypdf`, `Pillow`, and `RapidOCR`. These components allow the system to handle uploaded screenshots, images, and PDF documents. This was useful because coaching in the real world often includes progress photos, nutrition labels, lab reports, and fitness screenshots.

## 12. Why We Changed Models and Providers Over Time

One of the questions behind this documentation is not only what we used, but why we changed things while building the project.

The short answer is that each change came from a practical limitation we discovered during implementation.

### 11.1 From Rules Only to Rules + ML

At first, rule-based routing was useful because it gave the system stable behavior. However, we saw that short real messages were too diverse for simple rules. Users would mix Arabic and English, omit explicit keywords, or ask indirectly. That is why we added trained classifiers for conversation intent and plan intent.

### 11.2 From One LLM Provider to Multi-Provider Support

OpenAI was very useful at the start because it made prototyping fast and gave strong response quality. But relying only on one cloud provider created problems related to cost, API dependence, and deployment flexibility. So we added Ollama support. This gave us a local-first path and made the system more realistic for self-hosted or university-demo environments.

### 11.3 From Pure Generation to Retrieval-Augmented Generation

When the LLM was asked questions without grounded context, the answers were not always consistent. This is normal for large language models. We addressed that by adding retrieval from curated datasets and user-specific RAG stores. That improved factual grounding and reduced hallucination.

### 11.4 From Single-Answer Planning to Candidate Options and Validation

Another issue we discovered was that a single generated plan was not enough. The user should be able to compare options, and the backend should be able to reject poor or repetitive outputs. This led to candidate generation, ranking, approval flow, and explicit validation logic.

### 11.5 From Simple Chat to Full Coaching Platform

The project started with a strong focus on AI chat, but a coaching system is not complete if it ends at conversation. We therefore expanded the system to include schedule storage, completion tracking, progress analysis, voice handling, and attachments. In other words, the project evolved from AI responses to AI-assisted coaching workflow.

## 13. Retrieval-Augmented Generation in the Project

Retrieval-augmented generation became one of the most important parts of the final system. Instead of asking the LLM to answer from scratch, the backend first gathers relevant context. This can include exercises, nutrition snippets, stored user context, attachment summaries, and retrieved data from the persistent RAG store.

The retrieval layer is beneficial for three reasons.

First, it grounds the response in data that belongs to the domain of fitness and nutrition. Second, it makes the answers more relevant to the user’s profile and current situation. Third, it gives the system a way to remain bilingual while still using consistent evidence sources.

The persistent RAG store uses multilingual MiniLM embeddings and FAISS indexing. When embeddings are not enough or not available, the system falls back to lexical matching. This combination gave us both speed and robustness.

## 14. Plan Generation and Validation Strategy

The system does not directly send a generated plan into the user schedule. Instead, plan generation is treated as a controlled workflow.

The backend first interprets the request and identifies whether it is asking for workout or nutrition guidance. Then it uses the profile, goal-related signals, tracking summary, retrieved context, and planning logic to generate candidate plan options. These options are summarized for the user. The user can request comparison, recommendation, more options, or approval.

This design was important for two reasons. First, it makes the system more transparent. Second, it lets us reduce bad outcomes caused by deterministic repetition or weak first-choice selection.

Validation is also central. Fitness advice is not a place where “probably fine” is good enough. We added deterministic logic to evaluate plan structure, completeness, plausibility, and consistency with the user profile. The validation layer complements the LLM rather than competing with it.

## 15. Frontend Features That Matter in the Final System

The frontend is not just a visual wrapper. It is part of the intelligence workflow because it collects the data that makes personalization possible.

The Coach page is where the user interacts with the assistant, uploads files, speaks with voice tools, and receives generated plan options. The Schedule page stores active plans, daily completions, exercise logs, notes, and workout reminders. The onboarding and profile pages are where the project captures goal, body data, fitness level, health conditions, and language preferences.

This matters academically because the ML models do not operate in isolation. They depend on how the system collects and structures information from the user.

## 16. Major Technical Challenges and How We Solved Them

### 15.1 Ambiguous User Intent

One challenge was routing ambiguous messages. A phrase like “I want a cutting plan” can mean nutrition, training, or both. Rules alone were unreliable, especially in Arabic. We solved this by combining heuristics with a dedicated plan-intent model and later refining the routing logic when we found edge cases.

### 15.2 Repetitive Plan Suggestions

Another issue was repeated plans. Deterministic scoring can return the same best option every time for the same profile. We addressed that by rotating recommendations among strong candidates and tracking recently delivered plan signatures.

### 15.3 Arabic Support

Arabic was not something we wanted to add as a final cosmetic layer. It had to be supported in routing, retrieval, response style, and user-facing explanations. This is one of the reasons multilingual embeddings and character-based text models were important.

### 15.4 Deployment Practicality

A system that works only with an expensive cloud API is not ideal for all environments. Adding Ollama support gave the project a more practical deployment story and made the architecture more resilient.

### 15.5 Attachment Understanding

User attachments introduced a different type of complexity. PDFs and screenshots required extraction, OCR, summarization, and chunking so they could be used by the RAG layer instead of staying as raw files.

## 17. Evaluation and Honest Reading of Results

The project stores metrics with each trained artifact, which is useful for documentation and reproducibility. However, the metrics need to be interpreted with context.

The goal model performs extremely well on a very large processed dataset, but some labels are derived from heuristics, so the model is best understood as a structured personalization component rather than a perfect “ground truth” predictor.

The success model shows perfect results, but the saved dataset is very small, so we do not claim that it is universally reliable. Instead, we use it as one signal among several.

The plan-intent model performed strongly and gave clear practical benefit in the live routing system. The conversation-intent model performed more modestly, but it still improved natural chat flow and reduced generic fallback behavior.

This is an important lesson from the project: in a real hybrid system, not every component needs to be perfect alone. What matters is whether the complete pipeline behaves better, safer, and more consistently than a simpler alternative.

## 18. Why This Project Is More Than a Chatbot

It is important to state clearly that FitCoach AI is not just an LLM chatbot with fitness branding. It includes:

1. Structured user data and feature engineering.
2. Multiple supervised ML models.
3. A multilingual retrieval layer.
4. Plan generation with option comparison and approval flow.
5. Deterministic validation logic.
6. Persistent schedule and progress tracking.
7. Attachment and OCR support.
8. Bilingual and multi-provider deployment support.

That combination is what makes the system a hybrid AI coaching platform.

## 19. Lessons Learned

The most important lesson from this project was that building a useful AI system is not about choosing the most advanced model and stopping there. The real challenge is orchestration.

We learned that:

1. Strong prompts alone are not enough for dependable product behavior.
2. Traditional ML still has an important role in modern AI systems.
3. Retrieval dramatically improves trustworthiness when the domain requires grounded answers.
4. Validation logic is essential when recommendations affect human health and habits.
5. Arabic support requires intentional design decisions, not just translation.
6. Deployment flexibility matters as much as raw model quality.

## 20. Future Work

There are several directions that can improve the project in future versions.

1. Expand the success model with a larger and more realistic adherence dataset.
2. Add stronger evaluation for RAG relevance and grounding quality.
3. Introduce ranking models for plan selection instead of rule-weighted recommendation only.
4. Improve wearable integration and use more live progress signals.
5. Add richer health-safety modules with medical review boundaries.
6. Build administrator tools for monitoring model drift and retraining schedules.

## 21. Conclusion

FitCoach AI was designed as a graduation project that shows how different AI methods can be combined into one practical system. The project started from a simpler coaching assistant idea and gradually evolved into a hybrid platform that uses supervised learning, retrieval, validation logic, and LLM generation in a coordinated way.

We used machine learning models where prediction and routing were needed. We used retrieval when grounding was necessary. We used deterministic logic where safety and consistency mattered. We used large language models where natural communication and flexible explanation were important. We changed providers and model strategies when the practical needs of the system changed, especially around cost, deployment, and multilingual behavior.

The final result is a project that reflects both engineering effort and AI reasoning. It demonstrates that effective personalized coaching is not achieved by one model alone, but by designing a complete pipeline where each part has a clear role and where the whole system is stronger than any individual component.

## Appendix A: Main Technical Components

Below is a simplified mapping between project responsibilities and implementation areas.

| Responsibility | Main Implementation Area |
| --- | --- |
| Frontend UI and user flows | `src/pages`, `src/components` |
| AI orchestration and APIs | `ai_backend/main.py` |
| Provider abstraction | `ai_backend/llm_client.py` |
| Feature engineering | `ai_backend/preprocess.py` |
| Goal model training | `ai_backend/train_goal_model.py` |
| Success model training | `ai_backend/train_success_model.py` |
| Plan-intent model training | `ai_backend/train_plan_intent_model.py` |
| Conversation-intent model training | `ai_backend/train_conversation_intent_model.py` |
| Prediction runtime | `ai_backend/predict.py` |
| Exercise retrieval | `ai_backend/ai_engine.py` |
| Persistent RAG and FAISS | `ai_backend/persistent_rag_store.py` |
| Multi-dataset training pipeline | `ai_backend/training_pipeline.py`, `ai_backend/multi_dataset_loader.py` |
| Attachment OCR and PDF/image analysis | `ai_backend/attachment_processing.py` |
| Plan recommendation and selection | `ai_backend/recommendation_engine.py`, `ai_backend/main.py` |
