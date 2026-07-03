// supabase/functions/upload-coachees/index.ts

import { handleOptions } from "../_shared/cors.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";
import {
  getCurrentUserContext,
  requireAnyRole,
} from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type CoacheeUploadRow = {
  name?: string;
  email?: string;
  organization?: string | null;
  department?: string | null;
  position?: string | null;
  job_level?: string | null;
  coaching_course_name?: string | null;
  phone?: string | null;
  employee_no?: string | null;
  job_title?: string | null;
  memo?: string | null;
};

type UploadCoacheesRequest = {
  project_id?: string;
  rows?: CoacheeUploadRow[];
};

type RowResult = {
  row_index: number;
  email: string | null;
  name: string | null;
  status: "created" | "linked_existing" | "skipped" | "error";
  coachee_id?: string;
  project_coachee_id?: string;
  error_code?: string;
  message?: string;
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

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isLikelyPhone(value: string | null): boolean {
  if (!value) return true;
  return /^[0-9+\-\s().]{8,30}$/.test(value);
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

    // MVP 1차: 운영자/시스템관리자만 업로드 허용
    // 고객사 담당자 업로드는 이후 client_manager 권한 검증 추가
    requireAnyRole(ctx, ["system_admin", "operator"]);

    // ============================================================
    // 2. 요청 body 파싱
    // ============================================================
    let body: UploadCoacheesRequest;

    try {
      body = await req.json();
    } catch (_error) {
      return errorResponse(
        "INVALID_JSON",
        "요청 본문이 올바른 JSON 형식이 아닙니다.",
        400,
      );
    }

    const projectId = normalizeText(body.project_id);
    const rows = Array.isArray(body.rows) ? body.rows : [];

    // ============================================================
    // 3. 기본 검증
    // ============================================================
    if (!projectId) {
      return errorResponse(
        "VALIDATION_ERROR",
        "project_id는 필수값입니다.",
        400,
      );
    }

    if (!isValidUuid(projectId)) {
      return errorResponse(
        "VALIDATION_ERROR",
        "project_id가 올바른 UUID 형식이 아닙니다.",
        400,
      );
    }

    if (rows.length === 0) {
      return errorResponse(
        "VALIDATION_ERROR",
        "등록할 피코치 rows가 비어 있습니다.",
        400,
      );
    }

    if (rows.length > 500) {
      return errorResponse(
        "VALIDATION_ERROR",
        "한 번에 등록 가능한 피코치 수는 최대 500명입니다.",
        400,
      );
    }

    // ============================================================
    // 4. 프로젝트/고객사 조회
    // ============================================================
    const { data: project, error: projectError } = await supabaseAdmin
      .from("coaching_projects")
      .select(
        "id, client_id, project_name, status, participant_code_rule, default_session_count",
      )
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) {
      return errorResponse(
        "PROJECT_LOOKUP_FAILED",
        "프로젝트 조회 중 오류가 발생했습니다.",
        500,
        {
          raw_message: projectError.message,
        },
      );
    }

    if (!project) {
      return errorResponse(
        "PROJECT_NOT_FOUND",
        "존재하지 않는 프로젝트입니다.",
        404,
      );
    }

    const clientId = project.client_id;

    if (!clientId) {
      return errorResponse(
        "PROJECT_CLIENT_MISSING",
        "프로젝트에 client_id가 연결되어 있지 않습니다.",
        500,
      );
    }

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
        "프로젝트의 고객사 정보를 찾을 수 없습니다.",
        404,
      );
    }

    if (client.status !== "active") {
      return errorResponse(
        "CLIENT_NOT_ACTIVE",
        "활성 상태가 아닌 고객사에는 피코치를 등록할 수 없습니다.",
        400,
        {
          client_status: client.status,
        },
      );
    }

    // ============================================================
    // 5. 파일 내 이메일 중복 사전 체크
    // ============================================================
    const seenEmails = new Set<string>();
    const duplicatedInPayload = new Set<string>();

    for (const row of rows) {
      const email = normalizeEmail(row.email);
      if (!email) continue;

      if (seenEmails.has(email)) {
        duplicatedInPayload.add(email);
      } else {
        seenEmails.add(email);
      }
    }

    // ============================================================
    // 6. 행별 처리
    // ============================================================
    const results: RowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      const rowIndex = i + 1;
      const name = normalizeText(row.name);
      const email = normalizeEmail(row.email);
      const organization = normalizeNullableText(row.organization);
      const department = normalizeNullableText(row.department);
      const position = normalizeNullableText(row.position);
      const jobLevel = normalizeNullableText(row.job_level);
      const coachingCourseName = normalizeNullableText(row.coaching_course_name);
      const phone = normalizeNullableText(row.phone);
      const employeeNo = normalizeNullableText(row.employee_no);
      const jobTitle = normalizeNullableText(row.job_title);
      const memo = normalizeNullableText(row.memo);

      // ------------------------------------------------------------
      // 행 검증
      // ------------------------------------------------------------
      if (!name) {
        results.push({
          row_index: rowIndex,
          email: email || null,
          name: null,
          status: "error",
          error_code: "NAME_REQUIRED",
          message: "이름은 필수값입니다.",
        });
        continue;
      }

      if (!email) {
        results.push({
          row_index: rowIndex,
          email: null,
          name,
          status: "error",
          error_code: "EMAIL_REQUIRED",
          message: "이메일은 필수값입니다.",
        });
        continue;
      }

      if (!isValidEmail(email)) {
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          error_code: "INVALID_EMAIL",
          message: "이메일 형식이 올바르지 않습니다.",
        });
        continue;
      }

      if (duplicatedInPayload.has(email)) {
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          error_code: "DUPLICATE_EMAIL_IN_PAYLOAD",
          message: "업로드 데이터 안에서 이메일이 중복되었습니다.",
        });
        continue;
      }

      if (!organization) {
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          error_code: "ORGANIZATION_REQUIRED",
          message: "소속은 필수값입니다.",
        });
        continue;
      }

      if (!department) {
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          error_code: "DEPARTMENT_REQUIRED",
          message: "부서는 필수값입니다.",
        });
        continue;
      }

      if (!position) {
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          error_code: "POSITION_REQUIRED",
          message: "직책은 필수값입니다.",
        });
        continue;
      }

      if (!isLikelyPhone(phone)) {
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          error_code: "INVALID_PHONE",
          message: "휴대폰 형식이 올바르지 않습니다.",
        });
        continue;
      }

      // ------------------------------------------------------------
      // coachees 조회 또는 생성
      // ------------------------------------------------------------
      const { data: existingCoachee, error: existingCoacheeError } =
        await supabaseAdmin
          .from("coachees")
          .select("id, client_id, name, email, status")
          .eq("client_id", clientId)
          .ilike("email", email)
          .maybeSingle();

      if (existingCoacheeError) {
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          error_code: "COACHEE_LOOKUP_FAILED",
          message: existingCoacheeError.message,
        });
        continue;
      }

      let coacheeId: string;
      let coacheeWasCreated = false;

      if (existingCoachee) {
        coacheeId = existingCoachee.id;

        // 최신 기본정보로 보정
        const { error: updateCoacheeError } = await supabaseAdmin
          .from("coachees")
          .update({
            name,
            phone,
            organization,
            department,
            position,
            job_level: jobLevel,
            employee_no: employeeNo,
            job_title: jobTitle,
            memo,
            status: "active",
            updated_at: new Date().toISOString(),
          })
          .eq("id", coacheeId);

        if (updateCoacheeError) {
          results.push({
            row_index: rowIndex,
            email,
            name,
            status: "error",
            error_code: "COACHEE_UPDATE_FAILED",
            message: updateCoacheeError.message,
          });
          continue;
        }
      } else {
        const { data: insertedCoachee, error: insertCoacheeError } =
          await supabaseAdmin
            .from("coachees")
            .insert({
              client_id: clientId,
              name,
              email,
              phone,
              organization,
              department,
              position,
              job_level: jobLevel,
              employee_no: employeeNo,
              job_title: jobTitle,
              memo,
              status: "active",
            })
            .select("id")
            .single();

        if (insertCoacheeError || !insertedCoachee) {
          results.push({
            row_index: rowIndex,
            email,
            name,
            status: "error",
            error_code: "COACHEE_CREATE_FAILED",
            message: insertCoacheeError?.message ?? "coachee insert failed",
          });
          continue;
        }

        coacheeId = insertedCoachee.id;
        coacheeWasCreated = true;
      }

      // ------------------------------------------------------------
      // project_coachees 기존 연결 확인
      // ------------------------------------------------------------
      const { data: existingProjectCoachee, error: existingPcError } =
        await supabaseAdmin
          .from("project_coachees")
          .select("id, onboarding_status")
          .eq("project_id", projectId)
          .eq("coachee_id", coacheeId)
          .maybeSingle();

      if (existingPcError) {
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          coachee_id: coacheeId,
          error_code: "PROJECT_COACHEE_LOOKUP_FAILED",
          message: existingPcError.message,
        });
        continue;
      }

      if (existingProjectCoachee) {
        // 기존 연결이 있으면 course/memo만 보정하고 skip 처리
        const { error: updatePcError } = await supabaseAdmin
          .from("project_coachees")
          .update({
            coaching_course_name: coachingCourseName,
            memo,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingProjectCoachee.id);

        if (updatePcError) {
          results.push({
            row_index: rowIndex,
            email,
            name,
            status: "error",
            coachee_id: coacheeId,
            project_coachee_id: existingProjectCoachee.id,
            error_code: "PROJECT_COACHEE_UPDATE_FAILED",
            message: updatePcError.message,
          });
          continue;
        }

        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "skipped",
          coachee_id: coacheeId,
          project_coachee_id: existingProjectCoachee.id,
          message: "이미 해당 프로젝트에 등록된 피코치입니다. 기본 정보만 보정했습니다.",
        });
        continue;
      }

      // ------------------------------------------------------------
      // project_coachees 신규 연결
      // ------------------------------------------------------------
      const { data: insertedProjectCoachee, error: insertPcError } =
        await supabaseAdmin
          .from("project_coachees")
          .insert({
            project_id: projectId,
            coachee_id: coacheeId,
            coaching_course_name: coachingCourseName,
            onboarding_status: "uploaded_by_client",
            diagnosis_status: "not_sent",
            needs_status: "not_sent",
            report_status: "not_created",
            memo,
          })
          .select("id")
          .single();

      if (insertPcError || !insertedProjectCoachee) {
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          coachee_id: coacheeId,
          error_code: "PROJECT_COACHEE_CREATE_FAILED",
          message: insertPcError?.message ?? "project_coachee insert failed",
        });
        continue;
      }

      results.push({
        row_index: rowIndex,
        email,
        name,
        status: coacheeWasCreated ? "created" : "linked_existing",
        coachee_id: coacheeId,
        project_coachee_id: insertedProjectCoachee.id,
        message: coacheeWasCreated
          ? "피코치가 생성되고 프로젝트에 등록되었습니다."
          : "기존 피코치를 프로젝트에 연결했습니다.",
      });
    }

    // ============================================================
    // 7. 결과 집계
    // ============================================================
    const created = results.filter((r) => r.status === "created").length;
    const linkedExisting = results.filter((r) =>
      r.status === "linked_existing"
    ).length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errors = results.filter((r) => r.status === "error").length;

    return okResponse(
      {
        project,
        client,
        summary: {
          total: rows.length,
          created,
          linked_existing: linkedExisting,
          skipped,
          errors,
          success_count: created + linkedExisting,
        },
        results,
        processed_by: {
          profile_id: ctx.profileId,
          email: ctx.email,
          roles: ctx.roles,
        },
      },
      "피코치 대상자 업로드 처리가 완료되었습니다.",
      200,
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
        "피코치 업로드 권한이 없습니다.",
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