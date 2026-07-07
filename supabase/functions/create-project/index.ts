// supabase/functions/create-project/index.ts

import { handleOptions } from "../_shared/cors.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";
import {
  getCurrentUserContext,
  requireAnyRole,
} from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type CreateProjectRequest = {
  client_id?: string;
  project_name?: string;
  project_type?: string | null;
  default_session_count?: number | null;
  diagnosis_type?: string | null;
  participant_code_rule?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  operator_id?: string | null;
  memo?: string | null;
};

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
): number {
  if (typeof value !== "number") return fallback;
  if (!Number.isInteger(value)) return fallback;
  if (value < 1) return fallback;
  return value;
}

function validateDateString(value: string | null): boolean {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

Deno.serve(async (req: Request) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return errorResponse(
      "METHOD_NOT_ALLOWED",
      "POST 방식으로 호출해야 합니다.",
      405,
    );
  }

  try {
    // ============================================================
    // 1. 로그인/권한 확인
    // ============================================================
    const ctx = await getCurrentUserContext(req);

    requireAnyRole(ctx, ["system_admin", "operator"]);

    // ============================================================
    // 2. 요청 body 파싱
    // ============================================================
    let body: CreateProjectRequest;

    try {
      body = await req.json();
    } catch (_error) {
      return errorResponse(
        "INVALID_JSON",
        "요청 본문이 올바른 JSON 형식이 아닙니다.",
        400,
      );
    }

    const clientId = normalizeText(body.client_id);
    const projectName = normalizeText(body.project_name);

    const projectType =
      normalizeNullableText(body.project_type) ?? "leadership_coaching";

    const defaultSessionCount = normalizePositiveInteger(
      body.default_session_count,
      8,
    );

    const diagnosisType =
      normalizeNullableText(body.diagnosis_type) ?? "leadership_self_32";

    const participantCodeRule =
      normalizeNullableText(body.participant_code_rule) ?? "client_sequence";

    const startDate = normalizeNullableText(body.start_date);
    const endDate = normalizeNullableText(body.end_date);
    const memo = normalizeNullableText(body.memo);

    // operator_id를 요청에서 받지 않으면 현재 로그인한 운영자를 기본값으로 사용
    const operatorIdFromBody = normalizeNullableText(body.operator_id);
    const operatorId = operatorIdFromBody ?? ctx.profileId;

    // ============================================================
    // 3. 입력값 검증
    // ============================================================
    if (!clientId) {
      return errorResponse(
        "VALIDATION_ERROR",
        "client_id는 필수값입니다.",
        400,
      );
    }

    if (!isValidUuid(clientId)) {
      return errorResponse(
        "VALIDATION_ERROR",
        "client_id가 올바른 UUID 형식이 아닙니다.",
        400,
      );
    }

    if (!projectName) {
      return errorResponse(
        "VALIDATION_ERROR",
        "project_name은 필수값입니다.",
        400,
      );
    }

    if (!["email_id", "client_sequence"].includes(participantCodeRule)) {
      return errorResponse(
        "VALIDATION_ERROR",
        "participant_code_rule은 email_id 또는 client_sequence만 사용할 수 있습니다.",
        400,
        {
          allowed_values: ["email_id", "client_sequence"],
        },
      );
    }

    if (!validateDateString(startDate)) {
      return errorResponse(
        "VALIDATION_ERROR",
        "start_date는 YYYY-MM-DD 형식이어야 합니다.",
        400,
      );
    }

    if (!validateDateString(endDate)) {
      return errorResponse(
        "VALIDATION_ERROR",
        "end_date는 YYYY-MM-DD 형식이어야 합니다.",
        400,
      );
    }

    if (startDate && endDate && startDate > endDate) {
      return errorResponse(
        "VALIDATION_ERROR",
        "start_date는 end_date보다 늦을 수 없습니다.",
        400,
      );
    }

    if (!isValidUuid(operatorId)) {
      return errorResponse(
        "VALIDATION_ERROR",
        "operator_id가 올바른 UUID 형식이 아닙니다.",
        400,
      );
    }

    // ============================================================
    // 4. client_id 존재 확인
    // ============================================================
    const { data: client, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("id, client_name, display_name, client_code, status")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError) {
      return errorResponse(
        "CLIENT_LOOKUP_FAILED",
        "고객사 조회 중 오류가 발생했습니다.",
        500,
        {
          raw_message: clientError.message,
        },
      );
    }

    if (!client) {
      return errorResponse(
        "CLIENT_NOT_FOUND",
        "존재하지 않는 고객사입니다.",
        404,
      );
    }

    if (client.status !== "active") {
      return errorResponse(
        "CLIENT_NOT_ACTIVE",
        "활성 상태가 아닌 고객사에는 프로젝트를 생성할 수 없습니다.",
        400,
        {
          client_status: client.status,
        },
      );
    }

    // ============================================================
    // 5. operator_id 존재 확인
    // ============================================================
    const { data: operatorProfile, error: operatorError } =
      await supabaseAdmin
        .from("user_profiles")
        .select("id, email, name, status")
        .eq("id", operatorId)
        .maybeSingle();

    if (operatorError) {
      return errorResponse(
        "OPERATOR_LOOKUP_FAILED",
        "운영자 정보 조회 중 오류가 발생했습니다.",
        500,
        {
          raw_message: operatorError.message,
        },
      );
    }

    if (!operatorProfile) {
      return errorResponse(
        "OPERATOR_NOT_FOUND",
        "존재하지 않는 operator_id입니다.",
        404,
      );
    }

    // ============================================================
    // 6. 같은 고객사 내 프로젝트명 중복 확인
    // ============================================================
    const { data: existingProject, error: existingProjectError } =
      await supabaseAdmin
        .from("projects")
        .select("id, project_name, status")
        .eq("client_id", clientId)
        .eq("project_name", projectName)
        .maybeSingle();

    if (existingProjectError) {
      return errorResponse(
        "PROJECT_LOOKUP_FAILED",
        "프로젝트 중복 확인 중 오류가 발생했습니다.",
        500,
        {
          raw_message: existingProjectError.message,
        },
      );
    }

    if (existingProject) {
      return errorResponse(
        "DUPLICATE_PROJECT_NAME",
        "같은 고객사에 동일한 프로젝트명이 이미 존재합니다.",
        409,
        {
          project_id: existingProject.id,
          project_name: existingProject.project_name,
          status: existingProject.status,
        },
      );
    }

    // ============================================================
    // 7. projects insert
    // ============================================================
    const { data: insertedProject, error: insertError } =
      await supabaseAdmin
        .from("projects")
        .insert({
          client_id: clientId,
          project_name: projectName,
          project_type: projectType,
          default_session_count: defaultSessionCount,
          diagnosis_type: diagnosisType,
          participant_code_rule: participantCodeRule,
          start_date: startDate,
          end_date: endDate,
          status: "draft",
          operator_id: operatorId,
          memo,
        })
        .select(
          "id, client_id, project_name, project_type, default_session_count, diagnosis_type, participant_code_rule, start_date, end_date, status, operator_id, memo, created_at",
        )
        .single();

    if (insertError) {
      return errorResponse(
        "PROJECT_CREATE_FAILED",
        "프로젝트 생성 중 오류가 발생했습니다.",
        500,
        {
          raw_message: insertError.message,
        },
      );
    }

    // ============================================================
    // 8. 성공 응답
    // ============================================================
    return okResponse(
      {
        project: insertedProject,
        client,
        created_by: {
          profile_id: ctx.profileId,
          email: ctx.email,
          roles: ctx.roles,
        },
      },
      "프로젝트가 생성되었습니다.",
      201,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (message === "UNAUTHORIZED") {
      return errorResponse(
        "UNAUTHORIZED",
        "로그인이 필요합니다.",
        401,
      );
    }

    if (message === "FORBIDDEN") {
      return errorResponse(
        "FORBIDDEN",
        "프로젝트 생성 권한이 없습니다.",
        403,
      );
    }

    if (message === "PROFILE_NOT_FOUND") {
      return errorResponse(
        "PROFILE_NOT_FOUND",
        "user_profiles에 연결된 사용자 정보가 없습니다.",
        404,
      );
    }

    if (message === "PROFILE_LOOKUP_FAILED") {
      return errorResponse(
        "PROFILE_LOOKUP_FAILED",
        "사용자 프로필 조회 중 오류가 발생했습니다.",
        500,
      );
    }

    if (message === "ROLES_LOOKUP_FAILED") {
      return errorResponse(
        "ROLES_LOOKUP_FAILED",
        "사용자 역할 조회 중 오류가 발생했습니다.",
        500,
      );
    }

    if (message === "SERVER_ENV_ERROR") {
      return errorResponse(
        "SERVER_ENV_ERROR",
        "서버 환경변수가 설정되지 않았습니다.",
        500,
      );
    }

    return errorResponse(
      "UNKNOWN_ERROR",
      "알 수 없는 오류가 발생했습니다.",
      500,
      {
        raw_message: message,
      },
    );
  }
});