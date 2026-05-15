# 404 Patient Not Found

A healthcare informatics dashboard built to explore clinical data interoperability, AI-assisted decision support, and FHIR R4 standards.

## What it does

This project turns raw synthetic patient data into a fully functional clinical dashboard. It lets you explore 60 patients across multiple views, from population-level analytics to individual patient timelines.

- **Dashboard** - population-wide stats including top diagnoses, medication usage, demographics, and encounter classification
- **Patient Registry** - all 60 patients with risk stratification badges (Low, Moderate, High, Critical)
- **Patient Detail** - chronological clinical timeline, vital trend charts, care gap alerts, and AI clinical summary
- **HL7 v2 Messages** - generates real ADT A01 admit messages from FHIR R4 data
- **AI Clinical Summaries** - structured clinical summaries powered by Claude

## Tech Stack

- Python, FastAPI
- SQLite (60 patients, 2088 conditions, 2629 medications, 3069 encounters, 26315 observations)
- Synthea for synthetic FHIR R4 patient generation
- Chart.js for data visualization
- Claude API for AI clinical summaries

## Running Locally

```bash
pip install -r requirements.txt
```

Create a `.env` file with your Anthropic API key:
