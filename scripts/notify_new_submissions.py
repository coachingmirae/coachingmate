# -*- coding: utf-8 -*-
r"""
notify_new_submissions.py

CoachingMate 신규 제출 이메일 알림 스크립트

실행:
cd D:/coachingmate_mvp
python scripts/notify_new_submissions.py

동작:
1. Supabase submissions에서 최종 제출 데이터를 조회합니다.
2. admin_notification_recipients의 활성 운영자 이메일 목록을 조회합니다.
3. submission_notification_logs에 아직 sent 기록이 없는 제출 건만 이메일을 발송합니다.
4. 발송 성공/실패 이력을 submission_notification_logs에 기록합니다.

.env 필요값:
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=
EMAIL_SMTP_PASSWORD=
EMAIL_FROM=
EMAIL_FROM_NAME=CoachingMate

선택값:
NOTIFY_MAX_RESULTS=100
NOTIFY_TARGET_PARTICIPANT_CODE=
ADMIN_BASE_URL=https://coachingmate.co.kr
"""

import os
import ssl
import smtplib
from pathlib import Path
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr

from dotenv import load_dotenv
from supabase import create_client
from postgrest.exceptions import APIError


BASE_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BASE_DIR / ".env"

load_dotenv(ENV_PATH)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

EMAIL_SMTP_HOST = os.getenv("EMAIL_SMTP_HOST", "smtp.gmail.com").strip()
EMAIL_SMTP_PORT = int(os.getenv("EMAIL_SMTP_PORT", "587"))
EMAIL_SMTP_USER = os.getenv("EMAIL_SMTP_USER", "").strip()
EMAIL_SMTP_PASSWORD = os.getenv("EMAIL_SMTP_PASSWORD", "").strip()
EMAIL_FROM = os.getenv("EMAIL_FROM", EMAIL_SMTP_USER).strip()
EMAIL_FROM_NAME = os.getenv("EMAIL_FROM_NAME", "CoachingMate").strip()

NOTIFY_MAX_RESULTS = int(os.getenv("NOTIFY_MAX_RESULTS", "100"))
NOTIFY_TARGET_PARTICIPANT_CODE = os.getenv("NOTIFY_TARGET_PARTICIPANT_CODE", "").strip()
ADMIN_BASE_URL = os.getenv("ADMIN_BASE_URL", "https://coachingmate.co.kr").strip()


def print_line(char="-", width=78):
    print(char * width)


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_dict(value):
    return value if isinstance(value, dict) else {}


def require_env():
    missing = []

    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")

    if not SUPABASE_SERVICE_ROLE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")

    if not EMAIL_SMTP_HOST:
        missing.append("EMAIL_SMTP_HOST")

    if not EMAIL_SMTP_PORT:
        missing.append("EMAIL_SMTP_PORT")

    if not EMAIL_SMTP_USER:
        missing.append("EMAIL_SMTP_USER")

    if not EMAIL_SMTP_PASSWORD:
        missing.append("EMAIL_SMTP_PASSWORD")

    if not EMAIL_FROM:
        missing.append("EMAIL_FROM")

    if missing:
        raise RuntimeError(f".env 설정 누락: {', '.join(missing)}")


def get_supabase_client():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def fetch_active_recipients(supabase):
    response = (
        supabase
        .table("admin_notification_recipients")
        .select("id, email, name, role, is_active")
        .eq("is_active", True)
        .order("created_at", desc=False)
        .execute()
    )

    return response.data or []


def fetch_recent_submissions(supabase):
    query = (
        supabase
        .table("submissions")
        .select("id, submitted_at, participant_code, basic_info, leadership_answers, needs_answers")
        .order("submitted_at", desc=False)
        .limit(NOTIFY_MAX_RESULTS)
    )

    if NOTIFY_TARGET_PARTICIPANT_CODE:
        query = query.eq("participant_code", NOTIFY_TARGET_PARTICIPANT_CODE)

    response = query.execute()

    return response.data or []


def fetch_sent_log_keys(supabase):
    response = (
        supabase
        .table("submission_notification_logs")
        .select("submission_id, recipient_email, notification_type, status")
        .eq("notification_type", "new_submission")
        .eq("status", "sent")
        .execute()
    )

    rows = response.data or []

    return {
        (
            row.get("submission_id"),
            str(row.get("recipient_email", "")).lower(),
            row.get("notification_type", "new_submission"),
        )
        for row in rows
    }


def build_email(submission, recipient):
    participant_code = submission.get("participant_code", "")
    submitted_at = submission.get("submitted_at", "")
    basic_info = safe_dict(submission.get("basic_info"))
    leadership_answers = safe_dict(submission.get("leadership_answers"))
    needs_answers = safe_dict(submission.get("needs_answers"))

    name = basic_info.get("name", "")
    company = basic_info.get("company", "")
    position = basic_info.get("position", "")
    department = basic_info.get("department", "")

    subject = f"[CoachingMate] 신규 사전진단 제출 1건 - {participant_code}"

    text_body = f"""CoachingMate 신규 제출 알림

새로운 리더십 코칭 사전진단 응답이 제출되었습니다.

참여코드: {participant_code}
제출일시: {submitted_at}

기본정보
- 성명: {name}
- 회사: {company}
- 부서: {department}
- 직책/직위: {position}

응답 현황
- 리더십 진단: {len(leadership_answers)} / 32
- 코칭 니즈조사: {len(needs_answers)} / 12

관리자 확인:
- Supabase submissions 테이블
- Google Sheet 동기화 결과
- 로컬 확인 스크립트: python scripts/check_supabase_data.py

본 메일은 CoachingMate 제출 알림 시스템에서 자동 발송되었습니다.
"""

    html_body = f"""
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2 style="margin-bottom: 8px;">CoachingMate 신규 제출 알림</h2>
      <p>새로운 리더십 코칭 사전진단 응답이 제출되었습니다.</p>

      <table style="border-collapse: collapse; margin-top: 16px;">
        <tr>
          <td style="padding: 6px 12px; font-weight: bold;">참여코드</td>
          <td style="padding: 6px 12px;">{participant_code}</td>
        </tr>
        <tr>
          <td style="padding: 6px 12px; font-weight: bold;">제출일시</td>
          <td style="padding: 6px 12px;">{submitted_at}</td>
        </tr>
        <tr>
          <td style="padding: 6px 12px; font-weight: bold;">성명</td>
          <td style="padding: 6px 12px;">{name}</td>
        </tr>
        <tr>
          <td style="padding: 6px 12px; font-weight: bold;">회사</td>
          <td style="padding: 6px 12px;">{company}</td>
        </tr>
        <tr>
          <td style="padding: 6px 12px; font-weight: bold;">부서</td>
          <td style="padding: 6px 12px;">{department}</td>
        </tr>
        <tr>
          <td style="padding: 6px 12px; font-weight: bold;">직책/직위</td>
          <td style="padding: 6px 12px;">{position}</td>
        </tr>
      </table>

      <p style="margin-top: 18px;">
        리더십 진단: <strong>{len(leadership_answers)} / 32</strong><br />
        코칭 니즈조사: <strong>{len(needs_answers)} / 12</strong>
      </p>

      <p style="margin-top: 18px; color: #6b7280;">
        본 메일은 CoachingMate 제출 알림 시스템에서 자동 발송되었습니다.
      </p>
    </div>
    """

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((EMAIL_FROM_NAME, EMAIL_FROM))
    message["To"] = recipient["email"]
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    return message


def send_email(message):
    if EMAIL_SMTP_PORT == 465:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, context=context) as server:
            server.login(EMAIL_SMTP_USER, EMAIL_SMTP_PASSWORD)
            server.send_message(message)
    else:
        with smtplib.SMTP(EMAIL_SMTP_HOST, EMAIL_SMTP_PORT) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            server.login(EMAIL_SMTP_USER, EMAIL_SMTP_PASSWORD)
            server.send_message(message)


def upsert_notification_log(supabase, submission, recipient_email, status, error_message=""):
    payload = {
        "submission_id": submission.get("id"),
        "participant_code": submission.get("participant_code", ""),
        "submitted_at": submission.get("submitted_at", ""),
        "recipient_email": recipient_email,
        "notification_type": "new_submission",
        "status": status,
        "error_message": error_message[:1000] if error_message else None,
        "sent_at": now_iso(),
    }

    (
        supabase
        .table("submission_notification_logs")
        .upsert(
            payload,
            on_conflict="submission_id,recipient_email,notification_type",
        )
        .execute()
    )


def main():
    print("=" * 78)
    print("CoachingMate 신규 제출 이메일 알림")
    print("=" * 78)

    require_env()

    print(f"ENV_PATH                    : {ENV_PATH}")
    print(f"SUPABASE_URL                : {SUPABASE_URL}")
    print(f"EMAIL_SMTP_HOST             : {EMAIL_SMTP_HOST}")
    print(f"EMAIL_SMTP_PORT             : {EMAIL_SMTP_PORT}")
    print(f"EMAIL_FROM                  : {EMAIL_FROM}")
    print(f"NOTIFY_TARGET_PARTICIPANT   : {NOTIFY_TARGET_PARTICIPANT_CODE or '(전체)'}")
    print(f"NOTIFY_MAX_RESULTS          : {NOTIFY_MAX_RESULTS}")
    print("=" * 78)

    supabase = get_supabase_client()

    try:
        recipients = fetch_active_recipients(supabase)
        submissions = fetch_recent_submissions(supabase)
        sent_log_keys = fetch_sent_log_keys(supabase)
    except APIError as error:
        print("[ERROR] Supabase 조회 오류")
        print(error)
        return

    print(f"활성 운영자 이메일 수: {len(recipients)}")
    print(f"제출 데이터 조회 건수: {len(submissions)}")

    if not recipients:
        print("활성 운영자 이메일이 없습니다.")
        print("admin_notification_recipients 테이블에 수신자를 등록하세요.")
        return

    if not submissions:
        print("알림 대상 제출 데이터가 없습니다.")
        return

    send_count = 0
    skip_count = 0
    fail_count = 0

    for submission in submissions:
        submission_id = submission.get("id")
        participant_code = submission.get("participant_code", "")
        submitted_at = submission.get("submitted_at", "")

        for recipient in recipients:
            recipient_email = str(recipient.get("email", "")).strip()
            key = (submission_id, recipient_email.lower(), "new_submission")

            if key in sent_log_keys:
                skip_count += 1
                print(f"[SKIP] 이미 발송됨: {participant_code} / {recipient_email}")
                continue

            try:
                message = build_email(submission, recipient)
                send_email(message)
                upsert_notification_log(supabase, submission, recipient_email, "sent")

                send_count += 1
                print(f"[SENT] {participant_code} / {submitted_at} → {recipient_email}")

            except Exception as error:
                fail_count += 1
                error_message = str(error)
                print(f"[FAIL] {participant_code} → {recipient_email}: {error_message}")

                try:
                    upsert_notification_log(
                        supabase,
                        submission,
                        recipient_email,
                        "failed",
                        error_message=error_message,
                    )
                except Exception as log_error:
                    print(f"[WARN] 실패 로그 저장 실패: {log_error}")

    print_line()
    print("알림 발송 결과")
    print_line()
    print(f"발송 성공: {send_count}")
    print(f"이미 발송 SKIP: {skip_count}")
    print(f"발송 실패: {fail_count}")
    print("=" * 78)


if __name__ == "__main__":
    main()
