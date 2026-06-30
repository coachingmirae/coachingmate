# -*- coding: utf-8 -*-
"""
sync_supabase_to_google_sheet.py

CoachingMate Supabase → Google Sheet 동기화 스크립트

실행:
cd D:/coachingmate_mvp
python scripts/sync_supabase_to_google_sheet.py

전제:
1. .env에 아래 값이 있어야 합니다.
   SUPABASE_URL=
   SUPABASE_SERVICE_ROLE_KEY=
   GOOGLE_SERVICE_ACCOUNT_FILE=D:\coachingmate_mvp\secrets\service_account.json
   GOOGLE_SHEET_INTERNAL_ID=

2. Google Sheet에 service_account.json의 client_email을 편집자로 공유해야 합니다.

3. Google Sheet에는 아래 3개 탭이 있어야 합니다.
   submissions
   leadership_responses
   needs_responses
"""

import os
import json
from pathlib import Path
from datetime import datetime, timezone

import gspread
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from supabase import create_client
from postgrest.exceptions import APIError


BASE_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BASE_DIR / ".env"
LOG_DIR = BASE_DIR / "data" / "logs"

load_dotenv(ENV_PATH)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

GOOGLE_SERVICE_ACCOUNT_FILE = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "").strip()
GOOGLE_SHEET_INTERNAL_ID = os.getenv("GOOGLE_SHEET_INTERNAL_ID", "").strip()

SYNC_TARGET_PARTICIPANT_CODE = os.getenv("SYNC_TARGET_PARTICIPANT_CODE", "").strip()
SYNC_MAX_RESULTS = int(os.getenv("SYNC_MAX_RESULTS", "100"))

SHEET_SUBMISSIONS = "submissions"
SHEET_LEADERSHIP = "leadership_responses"
SHEET_NEEDS = "needs_responses"

SUBMISSIONS_HEADERS = [
    "submitted_at",
    "participant_code",
    "name",
    "company",
    "department",
    "position",
    "email",
    "phone",
    "status",
    "basic_info_json",
    "leadership_json",
    "needs_json",
    "raw_json",
    "synced_at",
]

LEADERSHIP_HEADERS = [
    "submitted_at",
    "participant_code",
    "item_code",
    "value",
    "synced_at",
]

NEEDS_HEADERS = [
    "submitted_at",
    "participant_code",
    "question_code",
    "answer",
    "synced_at",
]

LEADERSHIP_CODES = [f"Q{i:02d}" for i in range(1, 33)]

NEEDS_FIELD_TO_CODE = {
    "currentWork": "N00",
    "need1": "N01",
    "need2": "N02",
    "need3": "N03",
    "need4": "N04",
    "need5": "N05",
    "need6": "N06",
    "need7": "N07",
    "need8": "N08",
    "need9": "N09",
    "need10": "N10",
    "need11": "N11",
}

NEEDS_ORDER = [
    "currentWork",
    "need1",
    "need2",
    "need3",
    "need4",
    "need5",
    "need6",
    "need7",
    "need8",
    "need9",
    "need10",
    "need11",
]


def print_line(char="-", width=78):
    print(char * width)


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def to_json_text(value):
    return json.dumps(value or {}, ensure_ascii=False, separators=(",", ":"))


def safe_dict(value):
    return value if isinstance(value, dict) else {}


def require_env():
    missing = []

    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")

    if not SUPABASE_SERVICE_ROLE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")

    if not GOOGLE_SERVICE_ACCOUNT_FILE:
        missing.append("GOOGLE_SERVICE_ACCOUNT_FILE")

    if not GOOGLE_SHEET_INTERNAL_ID:
        missing.append("GOOGLE_SHEET_INTERNAL_ID")

    if missing:
        raise RuntimeError(f".env 설정 누락: {', '.join(missing)}")

    service_account_path = Path(GOOGLE_SERVICE_ACCOUNT_FILE)

    if not service_account_path.exists():
        raise FileNotFoundError(f"service_account.json 파일을 찾을 수 없습니다: {service_account_path}")


def get_supabase_client():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def get_google_spreadsheet():
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]

    credentials = Credentials.from_service_account_file(
        GOOGLE_SERVICE_ACCOUNT_FILE,
        scopes=scopes,
    )

    gc = gspread.authorize(credentials)

    return gc.open_by_key(GOOGLE_SHEET_INTERNAL_ID)


def get_or_create_worksheet(spreadsheet, title, headers):
    try:
        worksheet = spreadsheet.worksheet(title)
    except gspread.WorksheetNotFound:
        worksheet = spreadsheet.add_worksheet(
            title=title,
            rows=1000,
            cols=max(20, len(headers)),
        )

    values = worksheet.get_all_values()

    if not values:
        worksheet.append_row(headers, value_input_option="USER_ENTERED")
    else:
        existing_headers = values[0]
        if existing_headers != headers:
            worksheet.update("A1", [headers])

    return worksheet


def fetch_submissions(supabase):
    query = (
        supabase
        .table("submissions")
        .select("id, submitted_at, participant_code, basic_info, leadership_answers, needs_answers, raw_payload")
        .order("submitted_at", desc=False)
        .limit(SYNC_MAX_RESULTS)
    )

    if SYNC_TARGET_PARTICIPANT_CODE:
        query = query.eq("participant_code", SYNC_TARGET_PARTICIPANT_CODE)

    response = query.execute()

    return response.data or []


def get_existing_submission_keys(worksheet):
    rows = worksheet.get_all_records()

    keys = set()

    for row in rows:
        participant_code = str(row.get("participant_code", "")).strip()
        submitted_at = str(row.get("submitted_at", "")).strip()

        if participant_code and submitted_at:
            keys.add((participant_code, submitted_at))

    return keys


def build_submission_row(row, synced_at):
    basic_info = safe_dict(row.get("basic_info"))
    leadership_answers = safe_dict(row.get("leadership_answers"))
    needs_answers = safe_dict(row.get("needs_answers"))
    raw_payload = safe_dict(row.get("raw_payload"))

    return [
        row.get("submitted_at", ""),
        row.get("participant_code", ""),
        basic_info.get("name", ""),
        basic_info.get("company", ""),
        basic_info.get("department", ""),
        basic_info.get("position", ""),
        basic_info.get("email", ""),
        basic_info.get("phone", ""),
        "submitted",
        to_json_text(basic_info),
        to_json_text(leadership_answers),
        to_json_text(needs_answers),
        to_json_text(raw_payload),
        synced_at,
    ]


def build_leadership_rows(row, synced_at):
    submitted_at = row.get("submitted_at", "")
    participant_code = row.get("participant_code", "")
    answers = safe_dict(row.get("leadership_answers"))

    result = []

    for code in LEADERSHIP_CODES:
        result.append([
            submitted_at,
            participant_code,
            code,
            answers.get(code, ""),
            synced_at,
        ])

    return result


def build_needs_rows(row, synced_at):
    submitted_at = row.get("submitted_at", "")
    participant_code = row.get("participant_code", "")
    answers = safe_dict(row.get("needs_answers"))

    result = []

    for field_name in NEEDS_ORDER:
        result.append([
            submitted_at,
            participant_code,
            NEEDS_FIELD_TO_CODE[field_name],
            answers.get(field_name, ""),
            synced_at,
        ])

    return result


def append_rows_if_any(worksheet, rows):
    if not rows:
        return 0

    worksheet.append_rows(
        rows,
        value_input_option="USER_ENTERED",
        insert_data_option="INSERT_ROWS",
    )

    return len(rows)


def save_sync_log(summary):
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = LOG_DIR / f"sync_supabase_to_google_sheet_{timestamp}.json"

    output_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )

    return output_path


def main():
    print("=" * 78)
    print("CoachingMate Supabase → Google Sheet 동기화")
    print("=" * 78)

    require_env()

    print(f"ENV_PATH                  : {ENV_PATH}")
    print(f"SUPABASE_URL              : {SUPABASE_URL}")
    print(f"GOOGLE_SERVICE_ACCOUNT    : {GOOGLE_SERVICE_ACCOUNT_FILE}")
    print(f"GOOGLE_SHEET_INTERNAL_ID  : {GOOGLE_SHEET_INTERNAL_ID}")
    print(f"SYNC_TARGET_PARTICIPANT   : {SYNC_TARGET_PARTICIPANT_CODE or '(전체)'}")
    print(f"SYNC_MAX_RESULTS          : {SYNC_MAX_RESULTS}")
    print("=" * 78)

    supabase = get_supabase_client()

    try:
        submissions = fetch_submissions(supabase)
    except APIError as error:
        print("[ERROR] Supabase 조회 오류")
        print(error)
        return

    print(f"Supabase 최종 제출 조회 건수: {len(submissions)}")

    if not submissions:
        print("동기화할 제출 데이터가 없습니다.")
        return

    spreadsheet = get_google_spreadsheet()

    ws_submissions = get_or_create_worksheet(
        spreadsheet,
        SHEET_SUBMISSIONS,
        SUBMISSIONS_HEADERS,
    )
    ws_leadership = get_or_create_worksheet(
        spreadsheet,
        SHEET_LEADERSHIP,
        LEADERSHIP_HEADERS,
    )
    ws_needs = get_or_create_worksheet(
        spreadsheet,
        SHEET_NEEDS,
        NEEDS_HEADERS,
    )

    existing_keys = get_existing_submission_keys(ws_submissions)

    submission_rows_to_append = []
    leadership_rows_to_append = []
    needs_rows_to_append = []

    skipped_count = 0
    synced_submission_count = 0
    synced_items = []

    for row in submissions:
        participant_code = row.get("participant_code", "")
        submitted_at = row.get("submitted_at", "")
        key = (participant_code, submitted_at)

        if key in existing_keys:
            skipped_count += 1
            print(f"[SKIP] 이미 동기화됨: {participant_code} / {submitted_at}")
            continue

        synced_at = now_iso()

        submission_rows_to_append.append(build_submission_row(row, synced_at))
        leadership_rows_to_append.extend(build_leadership_rows(row, synced_at))
        needs_rows_to_append.extend(build_needs_rows(row, synced_at))

        synced_submission_count += 1

        synced_items.append({
            "participant_code": participant_code,
            "submitted_at": submitted_at,
            "leadership_count": len(safe_dict(row.get("leadership_answers"))),
            "needs_count": len(safe_dict(row.get("needs_answers"))),
            "synced_at": synced_at,
        })

        print(f"[SYNC] 신규 동기화 대상: {participant_code} / {submitted_at}")

    print_line()

    appended_submissions = append_rows_if_any(ws_submissions, submission_rows_to_append)
    appended_leadership = append_rows_if_any(ws_leadership, leadership_rows_to_append)
    appended_needs = append_rows_if_any(ws_needs, needs_rows_to_append)

    summary = {
        "synced_at": now_iso(),
        "supabase_submission_count": len(submissions),
        "synced_submission_count": synced_submission_count,
        "skipped_count": skipped_count,
        "appended_submissions_rows": appended_submissions,
        "appended_leadership_rows": appended_leadership,
        "appended_needs_rows": appended_needs,
        "synced_items": synced_items,
    }

    log_path = save_sync_log(summary)

    print("동기화 결과")
    print_line()
    print(f"신규 제출 동기화 건수       : {synced_submission_count}")
    print(f"기존 동기화 SKIP 건수       : {skipped_count}")
    print(f"submissions 추가 행         : {appended_submissions}")
    print(f"leadership_responses 추가 행: {appended_leadership}")
    print(f"needs_responses 추가 행     : {appended_needs}")
    print(f"로그 저장 위치              : {log_path}")
    print("=" * 78)

    if synced_submission_count == 0:
        print("새로 추가된 제출이 없습니다. 이미 모두 동기화된 상태입니다.")
    else:
        print("Google Sheet 동기화가 완료되었습니다.")


if __name__ == "__main__":
    main()
