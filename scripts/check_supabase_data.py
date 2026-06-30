# -*- coding: utf-8 -*-
"""
check_supabase_data.py

CoachingMate Supabase 데이터 확인용 스크립트

실행:
cd D:/coachingmate_mvp
python scripts/check_supabase_data.py

기능:
1. 최근 최종 제출 데이터 확인
2. 참여자 상태 확인
3. 리더십 응답 32문항 저장 여부 확인
4. 리더십 G/F 요인별 평균 계산
5. 니즈조사 12문항 저장 내용 확인
6. 필요 시 상세 JSON을 logs 폴더에 저장
"""

import os
import json
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv
from supabase import create_client
from postgrest.exceptions import APIError


BASE_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BASE_DIR / ".env"
LOG_DIR = BASE_DIR / "data" / "logs"

load_dotenv(ENV_PATH)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

TARGET_PARTICIPANT_CODE = os.getenv("CHECK_PARTICIPANT_CODE", "").strip()
MAX_RESULTS = int(os.getenv("CHECK_MAX_RESULTS", "10"))

LEADERSHIP_GROUPS = {
    "G1_전략적 통찰": ["Q01", "Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q08"],
    "G2_조직 구축 및 성장 견인": ["Q09", "Q10", "Q11", "Q12", "Q13", "Q14", "Q15", "Q16"],
    "G3_관계 및 소통 영향력": ["Q17", "Q18", "Q19", "Q20", "Q21", "Q22", "Q23", "Q24"],
    "G4_자기 경영 및 민첩성": ["Q25", "Q26", "Q27", "Q28", "Q29", "Q30", "Q31", "Q32"],
}

LEADERSHIP_FACTORS = {
    "F1_비전 수립 및 공유": ["Q01", "Q02", "Q03", "Q04"],
    "F2_데이터 기반 전략적 의사결정": ["Q05", "Q06", "Q07", "Q08"],
    "F3_고성과 팀 구축 및 책임 경영": ["Q09", "Q10", "Q11", "Q12"],
    "F4_조직 및 성과 관리": ["Q13", "Q14", "Q15", "Q16"],
    "F5_인재 육성 및 조직 문화 정렬": ["Q17", "Q18", "Q19", "Q20"],
    "F6_심리적 안전감 기반 갈등 조정": ["Q21", "Q22", "Q23", "Q24"],
    "F7_평정심 및 존재감": ["Q25", "Q26", "Q27", "Q28"],
    "F8_회복탄력성 및 성장 마인드셋": ["Q29", "Q30", "Q31", "Q32"],
}

NEEDS_LABELS = {
    "currentWork": "N00_현재 하고 계신 일",
    "need1": "N01_코칭 목표",
    "need2": "N02_성공 기준/KPI",
    "need3": "N03_다루고 싶은 주제",
    "need4": "N04_이상적 리더/조직",
    "need5": "N05_강점/장점",
    "need6": "N06_개선 영역",
    "need7": "N07_조직문화 정의",
    "need8": "N08_조직 차원의 걸림돌",
    "need9": "N09_관계 만족도/피드백",
    "need10": "N10_차세대 리더 육성 어려움",
    "need11": "N11_추가 정보/요청사항",
}


def require_env():
    missing = []

    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")

    if not SUPABASE_SERVICE_ROLE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")

    if missing:
        raise RuntimeError(f".env 설정 누락: {', '.join(missing)}")


def get_supabase_client():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def print_line(char="-", width=76):
    print(char * width)


def safe_dict(value):
    if isinstance(value, dict):
        return value
    return {}


def get_average(answers, question_codes):
    values = []

    for code in question_codes:
      value = answers.get(code)

      if value is None or value == "":
          continue

      try:
          values.append(float(value))
      except (TypeError, ValueError):
          continue

    if not values:
        return None

    return round(sum(values) / len(values), 2)


def get_missing_codes(answers, expected_codes):
    return [code for code in expected_codes if code not in answers or answers.get(code) in ("", None)]


def print_basic_summary(row):
    basic_info = safe_dict(row.get("basic_info"))

    print(f"제출일시          : {row.get('submitted_at')}")
    print(f"참여코드          : {row.get('participant_code')}")
    print(f"회사              : {basic_info.get('company', '')}")
    print(f"성명              : {basic_info.get('name', '')}")
    print(f"부서              : {basic_info.get('department', '')}")
    print(f"직책/직위         : {basic_info.get('position', '')}")
    print(f"이메일            : {basic_info.get('email', '')}")


def print_leadership_detail(leadership_answers):
    answers = safe_dict(leadership_answers)
    expected_codes = [f"Q{i:02d}" for i in range(1, 33)]
    missing_codes = get_missing_codes(answers, expected_codes)

    print_line()
    print("[리더십 진단]")
    print(f"응답 문항 수       : {len(answers)} / 32")

    if missing_codes:
        print(f"미응답 문항        : {', '.join(missing_codes)}")
    else:
        print("미응답 문항        : 없음")

    print()
    print("문항별 응답")
    for code in expected_codes:
        print(f"  {code}: {answers.get(code, '-')}")

    print()
    print("상위영역 G 평균")
    for group_name, codes in LEADERSHIP_GROUPS.items():
        avg = get_average(answers, codes)
        print(f"  {group_name}: {avg if avg is not None else '-'}")

    print()
    print("하위요인 F 평균")
    for factor_name, codes in LEADERSHIP_FACTORS.items():
        avg = get_average(answers, codes)
        print(f"  {factor_name}: {avg if avg is not None else '-'}")


def print_needs_detail(needs_answers):
    answers = safe_dict(needs_answers)

    print_line()
    print("[코칭 니즈조사]")
    print(f"저장 문항 수       : {len(answers)} / 12")

    for field_name, label in NEEDS_LABELS.items():
        value = answers.get(field_name, "")

        print()
        print(f"{label}")
        if value:
            print(f"  {value}")
        else:
            print("  -")


def fetch_recent_submissions(supabase):
    query = (
        supabase
        .table("submissions")
        .select("id, submitted_at, participant_code, basic_info, leadership_answers, needs_answers, raw_payload")
        .order("submitted_at", desc=True)
        .limit(MAX_RESULTS)
    )

    if TARGET_PARTICIPANT_CODE:
        query = query.eq("participant_code", TARGET_PARTICIPANT_CODE)

    return query.execute().data or []


def fetch_participant_state(supabase, participant_code):
    response = supabase.rpc("get_participant_state", {
        "p_participant_code": participant_code
    }).execute()

    return response.data or {}


def save_detail_json(rows):
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = LOG_DIR / f"check_supabase_submissions_{timestamp}.json"

    output_path.write_text(
        json.dumps(rows, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8"
    )

    return output_path


def main():
    require_env()

    print("=" * 76)
    print("CoachingMate Supabase 데이터 확인")
    print("=" * 76)
    print(f"ENV_PATH              : {ENV_PATH}")
    print(f"SUPABASE_URL          : {SUPABASE_URL}")
    print(f"TARGET_PARTICIPANT    : {TARGET_PARTICIPANT_CODE or '(최근 제출 전체)'}")
    print(f"MAX_RESULTS           : {MAX_RESULTS}")
    print("=" * 76)

    supabase = get_supabase_client()

    try:
        rows = fetch_recent_submissions(supabase)

    except APIError as error:
        print("[ERROR] Supabase API 오류")
        print(error)
        print()
        print("확인할 것:")
        print("1. submissions 테이블 존재 여부")
        print("2. .env의 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
        print("3. Supabase SQL Editor에서 notify pgrst, 'reload schema'; 실행")
        return

    if not rows:
        print("최종 제출 데이터가 없습니다.")
        print()
        print("draft 상태 확인이 필요하면 Supabase SQL Editor에서 아래를 실행하세요.")
        print("""
select
  p.participant_code,
  p.status,
  l.answered_count,
  l.answers as leadership_answers,
  n.answers as needs_answers
from public.participants p
left join public.leadership_responses l
  on p.id = l.participant_id
left join public.needs_responses n
  on p.id = n.participant_id
where p.participant_code = 'swon.cho7';
""")
        return

    print(f"조회된 최종 제출 건수: {len(rows)}")
    print_line("=")

    for index, row in enumerate(rows, start=1):
        leadership_answers = safe_dict(row.get("leadership_answers"))
        needs_answers = safe_dict(row.get("needs_answers"))
        participant_code = row.get("participant_code")

        print(f"[{index}] 최종 제출 요약")
        print_basic_summary(row)
        print(f"리더십 응답 수     : {len(leadership_answers)} / 32")
        print(f"니즈조사 응답 수   : {len(needs_answers)} / 12")

        try:
            state = fetch_participant_state(supabase, participant_code)
            print(f"현재 participant 상태: {state.get('status', '-')}")
        except Exception as error:
            print(f"현재 participant 상태 조회 실패: {error}")

        print_leadership_detail(leadership_answers)
        print_needs_detail(needs_answers)

        print_line("=")

    output_path = save_detail_json(rows)

    print("상세 JSON 저장 완료")
    print(f"저장 위치: {output_path}")
    print("=" * 76)


if __name__ == "__main__":
    main()
