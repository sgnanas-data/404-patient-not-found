"""
404 Patient Not Found — FastAPI Backend
Clinical interoperability dashboard: FHIR R4 + HL7 v2 + ICD-10 + Claude AI
"""

import os
import sqlite3
import datetime
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(override=True)

import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

api_key = os.environ.get("ANTHROPIC_API_KEY", "")
logger.info(f"ANTHROPIC_API_KEY loaded: {len(api_key)} chars, starts with: {api_key[:12]}..." if api_key else "ANTHROPIC_API_KEY: NOT SET")

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import anthropic

DB_PATH = Path(__file__).parent / "clinical.db"

app = FastAPI(title="404 Patient Not Found", version="1.0.0")


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------------------
# GET /api/patients — list all patients with condition/medication counts
# ---------------------------------------------------------------------------
def calculate_risk(condition_count):
    if condition_count >= 30:
        return "Critical"
    elif condition_count >= 20:
        return "High"
    elif condition_count >= 10:
        return "Moderate"
    return "Low"


@app.get("/api/patients")
def list_patients():
    conn = get_db()
    rows = conn.execute("""
        SELECT p.*,
               (SELECT COUNT(*) FROM conditions c WHERE c.patient_id = p.id) AS condition_count,
               (SELECT COUNT(*) FROM medications m WHERE m.patient_id = p.id) AS medication_count,
               (SELECT COUNT(*) FROM encounters e WHERE e.patient_id = p.id) AS encounter_count,
               (SELECT COUNT(*) FROM conditions c WHERE c.patient_id = p.id AND c.status = 'active') AS active_condition_count,
               (SELECT COUNT(*) FROM medications m WHERE m.patient_id = p.id AND m.status = 'active') AS active_medication_count,
               (SELECT COUNT(*) FROM encounters e WHERE e.patient_id = p.id AND e.start_date >= date('now', '-1 year')) AS recent_encounter_count
        FROM patients p
        ORDER BY p.name
    """).fetchall()
    conn.close()
    results = []
    for r in rows:
        d = dict(r)
        d["risk"] = calculate_risk(d["condition_count"])
        results.append(d)
    return results


# ---------------------------------------------------------------------------
# GET /api/patient/{id} — full patient detail with all clinical data
# ---------------------------------------------------------------------------
@app.get("/api/patient/{patient_id}")
def get_patient(patient_id: str):
    conn = get_db()
    patient = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if not patient:
        conn.close()
        raise HTTPException(status_code=404, detail="Patient not found")

    conditions = conn.execute(
        "SELECT * FROM conditions WHERE patient_id = ? ORDER BY onset_date DESC", (patient_id,)
    ).fetchall()

    medications = conn.execute(
        "SELECT * FROM medications WHERE patient_id = ? ORDER BY date DESC", (patient_id,)
    ).fetchall()

    encounters = conn.execute(
        "SELECT * FROM encounters WHERE patient_id = ? ORDER BY start_date DESC", (patient_id,)
    ).fetchall()

    observations = conn.execute(
        "SELECT * FROM observations WHERE patient_id = ? ORDER BY date DESC", (patient_id,)
    ).fetchall()

    conn.close()
    return {
        "patient": dict(patient),
        "conditions": [dict(r) for r in conditions],
        "medications": [dict(r) for r in medications],
        "encounters": [dict(r) for r in encounters],
        "observations": [dict(r) for r in observations],
    }


# ---------------------------------------------------------------------------
# GET /api/hl7/{id} — generate HL7 v2.4 ADT^A01 message
# ---------------------------------------------------------------------------
@app.get("/api/hl7/{patient_id}")
def generate_hl7(patient_id: str):
    conn = get_db()
    patient = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if not patient:
        conn.close()
        raise HTTPException(status_code=404, detail="Patient not found")

    conditions = conn.execute(
        "SELECT * FROM conditions WHERE patient_id = ? AND status = 'active' ORDER BY onset_date DESC LIMIT 5",
        (patient_id,),
    ).fetchall()

    encounters = conn.execute(
        "SELECT * FROM encounters WHERE patient_id = ? ORDER BY start_date DESC LIMIT 1",
        (patient_id,),
    ).fetchall()

    conn.close()

    now = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    dob = patient["birthdate"].replace("-", "") if patient["birthdate"] else ""
    gender = "M" if patient["gender"] == "male" else "F" if patient["gender"] == "female" else "U"

    name_parts = patient["name"].split()
    family = name_parts[-1] if name_parts else ""
    given = name_parts[0] if name_parts else ""

    msh = f"MSH|^~\\&|FHIR_DASHBOARD|FACILITY_01|RECEIVING_APP|RECEIVING_FAC|{now}||ADT^A01^ADT_A01|MSG{now}|P|2.4|||AL|NE"
    evn = f"EVN|A01|{now}"
    pid = f"PID|1||{patient_id[:20]}^^^FACILITY_01^MR||{family}^{given}^^^||{dob}|{gender}|||{patient['city']}^^{patient['state']}||{patient['phone']}|||||||||{patient['ethnicity']}|"

    pv1_reason = encounters[0]["reason"] if encounters and encounters[0]["reason"] else "General"
    pv1 = f"PV1|1|I|^^^FACILITY_01||||ATT_PHYS^^^|||||||||||V{now}^^^FACILITY_01|||||||||||||||||||||||||{now}"

    segments = [msh, evn, pid, pv1]

    for i, cond in enumerate(conditions, 1):
        icd = cond["icd10_code"] if cond["icd10_code"] else cond["snomed_code"]
        system = "I10" if cond["icd10_code"] else "SCT"
        dg1 = f"DG1|{i}|{system}|{icd}|{cond['description']}|{cond['onset_date'][:10].replace('-', '') if cond['onset_date'] else ''}|A"
        segments.append(dg1)

    message = "\r".join(segments)

    return {
        "patient_id": patient_id,
        "patient_name": patient["name"],
        "message_type": "ADT^A01",
        "hl7_version": "2.4",
        "message": message,
        "segments": segments,
        "segment_count": len(segments),
    }


# ---------------------------------------------------------------------------
# GET /api/summary/{id} — Claude AI clinical summary
# ---------------------------------------------------------------------------
@app.get("/api/summary/{patient_id}")
def get_summary(patient_id: str):
    conn = get_db()
    patient = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if not patient:
        conn.close()
        raise HTTPException(status_code=404, detail="Patient not found")

    conditions = conn.execute(
        "SELECT description, icd10_code, snomed_code, onset_date, status FROM conditions WHERE patient_id = ? ORDER BY onset_date DESC",
        (patient_id,),
    ).fetchall()

    medications = conn.execute(
        "SELECT name, status, date, dosage FROM medications WHERE patient_id = ? ORDER BY date DESC",
        (patient_id,),
    ).fetchall()

    recent_obs = conn.execute(
        "SELECT type, value, unit, date FROM observations WHERE patient_id = ? ORDER BY date DESC LIMIT 20",
        (patient_id,),
    ).fetchall()

    encounters_recent = conn.execute(
        "SELECT type, start_date, reason FROM encounters WHERE patient_id = ? ORDER BY start_date DESC LIMIT 5",
        (patient_id,),
    ).fetchall()

    conn.close()

    active_conditions = [dict(c) for c in conditions if c["status"] == "active"]
    resolved_conditions = [dict(c) for c in conditions if c["status"] != "active"]

    clinical_context = f"""Patient: {patient['name']}
DOB: {patient['birthdate']} | Gender: {patient['gender']} | Location: {patient['city']}, {patient['state']}

ACTIVE CONDITIONS ({len(active_conditions)}):
"""
    for c in active_conditions[:15]:
        code = c["icd10_code"] or c["snomed_code"]
        clinical_context += f"- {c['description']} (Code: {code}, Onset: {c['onset_date'][:10] if c['onset_date'] else 'Unknown'})\n"

    clinical_context += f"\nRESOLVED CONDITIONS ({len(resolved_conditions)}): "
    clinical_context += ", ".join(c["description"] for c in resolved_conditions[:10])

    clinical_context += f"\n\nCURRENT MEDICATIONS ({len([m for m in medications if m['status'] == 'active'])}):\n"
    for m in medications:
        if m["status"] == "active":
            clinical_context += f"- {m['name']} ({m['dosage']})\n"

    clinical_context += f"\nRECENT OBSERVATIONS:\n"
    for o in recent_obs:
        clinical_context += f"- {o['type']}: {o['value']} {o['unit']} ({o['date'][:10] if o['date'] else ''})\n"

    clinical_context += f"\nRECENT ENCOUNTERS:\n"
    for e in encounters_recent:
        clinical_context += f"- {e['type']} ({e['start_date'][:10] if e['start_date'] else ''}) — Reason: {e['reason'] or 'N/A'}\n"

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {
            "patient_id": patient_id,
            "patient_name": patient["name"],
            "summary": "AI summary unavailable — ANTHROPIC_API_KEY not set. Set the environment variable and restart the server.",
            "model": "none",
            "generated_at": datetime.datetime.now().isoformat(),
        }

    try:
        client = anthropic.Anthropic(api_key=api_key)
        logger.info(f"Calling Claude API for patient {patient_id} with key length {len(api_key)}")
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": f"""You are a clinical decision support AI. Analyze this patient's FHIR data and provide a concise clinical summary.

{clinical_context}

Provide a structured summary with these sections:
1. **Patient Overview** — one-line demographics and key identifiers
2. **Active Problem List** — prioritized list of current conditions with ICD-10/SNOMED codes
3. **Medication Review** — current medications, note any potential interactions or concerns
4. **Recent Clinical Activity** — summary of recent encounters and observations
5. **Care Gaps & Recommendations** — identified care gaps, overdue screenings, or recommended follow-ups
6. **Risk Assessment** — brief risk stratification based on comorbidities

Keep it clinical, concise, and actionable. Use medical terminology appropriately. This is synthetic data for educational purposes.""",
                }
            ],
        )

        summary_text = response.content[0].text
        logger.info(f"Claude API success for patient {patient_id}, response length: {len(summary_text)}")

        return {
            "patient_id": patient_id,
            "patient_name": patient["name"],
            "summary": summary_text,
            "model": "claude-sonnet-4-20250514",
            "generated_at": datetime.datetime.now().isoformat(),
        }
    except Exception as e:
        logger.error(f"Claude API error for patient {patient_id}: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"AI summary failed: {type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# GET /api/alerts — care gaps and clinical alerts (dashboard-wide)
# ---------------------------------------------------------------------------
@app.get("/api/alerts")
def get_alerts():
    conn = get_db()
    alerts = []
    patients = conn.execute("SELECT id, name FROM patients").fetchall()
    for p in patients:
        pid, pname = p["id"], p["name"]
        active_conds = conn.execute(
            "SELECT COUNT(*) FROM conditions WHERE patient_id = ? AND status = 'active'", (pid,)
        ).fetchone()[0]
        active_meds = conn.execute(
            "SELECT COUNT(*) FROM medications WHERE patient_id = ? AND status = 'active'", (pid,)
        ).fetchone()[0]
        last_enc = conn.execute(
            "SELECT MAX(start_date) FROM encounters WHERE patient_id = ?", (pid,)
        ).fetchone()[0]
        last_bp = conn.execute(
            "SELECT value, date FROM observations WHERE patient_id = ? AND type = 'Systolic Blood Pressure' ORDER BY date DESC LIMIT 1", (pid,)
        ).fetchone()
        last_glucose = conn.execute(
            "SELECT value, date FROM observations WHERE patient_id = ? AND type LIKE 'Glucose%' ORDER BY date DESC LIMIT 1", (pid,)
        ).fetchone()
        last_bmi = conn.execute(
            "SELECT value, date FROM observations WHERE patient_id = ? AND type LIKE 'Body mass index%' ORDER BY date DESC LIMIT 1", (pid,)
        ).fetchone()

        if last_enc and last_enc < (datetime.datetime.now() - datetime.timedelta(days=365)).strftime("%Y-%m-%d"):
            alerts.append({"patient_id": pid, "patient_name": pname, "type": "warning", "category": "Overdue Follow-up", "message": f"No encounter in over 12 months (last: {last_enc[:10]})"})
        if last_bp:
            try:
                bp_val = float(last_bp["value"])
                if bp_val >= 140:
                    alerts.append({"patient_id": pid, "patient_name": pname, "type": "critical", "category": "Abnormal Lab", "message": f"Systolic BP {bp_val:.0f} mmHg ({last_bp['date'][:10]})"})
            except (ValueError, TypeError):
                pass
        if last_glucose:
            try:
                glu_val = float(last_glucose["value"])
                if glu_val >= 200:
                    alerts.append({"patient_id": pid, "patient_name": pname, "type": "critical", "category": "Abnormal Lab", "message": f"Glucose {glu_val:.0f} mg/dL ({last_glucose['date'][:10]})"})
                elif glu_val >= 126:
                    alerts.append({"patient_id": pid, "patient_name": pname, "type": "warning", "category": "Abnormal Lab", "message": f"Glucose {glu_val:.0f} mg/dL ({last_glucose['date'][:10]})"})
            except (ValueError, TypeError):
                pass
        if last_bmi:
            try:
                bmi_val = float(last_bmi["value"])
                if bmi_val >= 35:
                    alerts.append({"patient_id": pid, "patient_name": pname, "type": "warning", "category": "Abnormal Lab", "message": f"BMI {bmi_val:.1f} ({last_bmi['date'][:10]})"})
            except (ValueError, TypeError):
                pass
        if active_meds >= 5:
            alerts.append({"patient_id": pid, "patient_name": pname, "type": "info", "category": "Medication Review", "message": f"Polypharmacy: {active_meds} active medications"})
        if active_conds >= 5:
            alerts.append({"patient_id": pid, "patient_name": pname, "type": "warning", "category": "Missing Screening", "message": f"Complex patient with {active_conds} active conditions - review care plan"})

    conn.close()
    alerts.sort(key=lambda a: {"critical": 0, "warning": 1, "info": 2}.get(a["type"], 3))
    return alerts[:50]


# ---------------------------------------------------------------------------
# GET /api/vitals/{id} — vital sign trends for a patient
# ---------------------------------------------------------------------------
@app.get("/api/vitals/{patient_id}")
def get_vitals(patient_id: str):
    conn = get_db()
    vital_types = {
        "Heart rate": "Heart Rate",
        "Systolic Blood Pressure": "Systolic BP",
        "Diastolic Blood Pressure": "Diastolic BP",
        "Body mass index (BMI) [Ratio]": "BMI",
        "Glucose [Mass/volume] in Blood": "Glucose",
        "Glucose [Mass/volume] in Serum or Plasma": "Glucose",
        "Oxygen saturation in Arterial blood": "O2 Saturation",
    }
    results = {}
    for obs_type, label in vital_types.items():
        rows = conn.execute(
            "SELECT value, unit, date FROM observations WHERE patient_id = ? AND type = ? ORDER BY date ASC",
            (patient_id, obs_type),
        ).fetchall()
        if rows:
            if label not in results:
                results[label] = []
            for r in rows:
                try:
                    results[label].append({"value": float(r["value"]), "unit": r["unit"], "date": r["date"][:10] if r["date"] else ""})
                except (ValueError, TypeError):
                    pass
    conn.close()
    return results


# ---------------------------------------------------------------------------
# GET /api/stats — dashboard-wide statistics
# ---------------------------------------------------------------------------
@app.get("/api/stats")
def get_stats():
    conn = get_db()
    cur = conn.cursor()

    total_patients = cur.execute("SELECT COUNT(*) FROM patients").fetchone()[0]
    total_conditions = cur.execute("SELECT COUNT(*) FROM conditions").fetchone()[0]
    total_medications = cur.execute("SELECT COUNT(*) FROM medications").fetchone()[0]
    total_encounters = cur.execute("SELECT COUNT(*) FROM encounters").fetchone()[0]
    total_observations = cur.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
    active_conditions = cur.execute("SELECT COUNT(*) FROM conditions WHERE status='active'").fetchone()[0]
    active_medications = cur.execute("SELECT COUNT(*) FROM medications WHERE status='active'").fetchone()[0]

    gender_dist = cur.execute(
        "SELECT gender, COUNT(*) as cnt FROM patients GROUP BY gender ORDER BY cnt DESC"
    ).fetchall()

    top_conditions = cur.execute("""
        SELECT description, COUNT(*) as cnt
        FROM conditions
        WHERE description NOT LIKE '%(finding)%'
          AND description NOT LIKE '%(situation)%'
          AND description NOT LIKE '%employment%'
        GROUP BY description
        ORDER BY cnt DESC
        LIMIT 10
    """).fetchall()

    top_medications = cur.execute("""
        SELECT name, COUNT(*) as cnt
        FROM medications
        GROUP BY name
        ORDER BY cnt DESC
        LIMIT 10
    """).fetchall()

    encounter_types = cur.execute("""
        SELECT type, COUNT(*) as cnt
        FROM encounters
        GROUP BY type
        ORDER BY cnt DESC
        LIMIT 8
    """).fetchall()

    conditions_by_status = cur.execute(
        "SELECT status, COUNT(*) as cnt FROM conditions GROUP BY status ORDER BY cnt DESC"
    ).fetchall()

    age_distribution = cur.execute("""
        SELECT
            CASE
                WHEN (strftime('%Y', 'now') - strftime('%Y', birthdate)) < 18 THEN '0-17'
                WHEN (strftime('%Y', 'now') - strftime('%Y', birthdate)) < 35 THEN '18-34'
                WHEN (strftime('%Y', 'now') - strftime('%Y', birthdate)) < 50 THEN '35-49'
                WHEN (strftime('%Y', 'now') - strftime('%Y', birthdate)) < 65 THEN '50-64'
                ELSE '65+'
            END as age_group,
            COUNT(*) as cnt
        FROM patients
        GROUP BY age_group
        ORDER BY age_group
    """).fetchall()

    encounters_by_class = cur.execute(
        "SELECT encounter_class, COUNT(*) as cnt FROM encounters GROUP BY encounter_class ORDER BY cnt DESC"
    ).fetchall()

    state_distribution = cur.execute(
        "SELECT state, COUNT(*) as cnt FROM patients GROUP BY state ORDER BY cnt DESC LIMIT 10"
    ).fetchall()

    conn.close()

    return {
        "totals": {
            "patients": total_patients,
            "conditions": total_conditions,
            "medications": total_medications,
            "encounters": total_encounters,
            "observations": total_observations,
            "active_conditions": active_conditions,
            "active_medications": active_medications,
        },
        "gender_distribution": [{"gender": r[0], "count": r[1]} for r in gender_dist],
        "top_conditions": [{"name": r[0], "count": r[1]} for r in top_conditions],
        "top_medications": [{"name": r[0], "count": r[1]} for r in top_medications],
        "encounter_types": [{"type": r[0], "count": r[1]} for r in encounter_types],
        "conditions_by_status": [{"status": r[0], "count": r[1]} for r in conditions_by_status],
        "age_distribution": [{"group": r[0], "count": r[1]} for r in age_distribution],
        "encounters_by_class": [{"class": r[0], "count": r[1]} for r in encounters_by_class],
        "state_distribution": [{"state": r[0], "count": r[1]} for r in state_distribution],
    }


# ---------------------------------------------------------------------------
# Serve static frontend
# ---------------------------------------------------------------------------
STATIC_DIR = Path(__file__).parent / "static"
STATIC_DIR.mkdir(exist_ok=True)


@app.get("/")
def serve_index():
    return FileResponse(str(STATIC_DIR / "index.html"))


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


if __name__ == "__main__":
    import uvicorn
    import sys
    port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8080
    uvicorn.run(app, host="127.0.0.1", port=port)
