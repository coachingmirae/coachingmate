// supabase/functions/upload-coachees/index.ts

import { handleOptions } from "../_shared/cors.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";
import {
  getCurrentUserContext,
  requireAnyRole,
} from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type UploadRow = {
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

type UploadRequest = {
  project_id?: string;
  rows?: UploadRow[];
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNullable(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
    console.log("[upload-coachees] START");

    const ctx = await getCurrentUserContext(req);
    console.log("[upload-coachees] AUTH_OK", ctx.email, ctx.roles);

    requireAnyRole(ctx, ["system_admin", "operator"]);

    const body = await req.json() as UploadRequest;

    const projectId = cleanText(body.project_id);
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!projectId) {
      return errorResponse(
        "VALIDATION_ERROR",
        "project_id는 필수값입니다.",
        400,
      );
    }

    if (rows.length === 0) {
      return errorResponse(
        "VALIDATION_ERROR",
        "rows가 비어 있습니다.",
        400,
      );
    }

    console.log("[upload-coachees] PROJECT_LOOKUP_START", projectId);

    const { data: project, error: projectError } = await supabaseAdmin
      .from("coaching_projects")
      .select("id, client_id, project_name, status")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) {
      console.error("[upload-coachees] PROJECT_LOOKUP_ERROR", projectError);
      return errorResponse(
        "PROJECT_LOOKUP_FAILED",
        "프로젝트 조회 중 오류가 발생했습니다.",
        500,
        { raw_message: projectError.message },
      );
    }

    if (!project) {
      return errorResponse(
        "PROJECT_NOT_FOUND",
        "존재하지 않는 프로젝트입니다.",
        404,
      );
    }

    if (!project.client_id) {
      return errorResponse(
        "PROJECT_CLIENT_MISSING",
        "프로젝트에 client_id가 없습니다.",
        500,
      );
    }

    const clientId = project.client_id;

    console.log("[upload-coachees] PROJECT_OK", project.id, clientId);

    const results = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      const rowIndex = i + 1;
      const name = cleanText(row.name);
      const email = cleanEmail(row.email);
      const organization = cleanNullable(row.organization);
      const department = cleanNullable(row.department);
      const position = cleanNullable(row.position);
      const jobLevel = cleanNullable(row.job_level);
      const coachingCourseName = cleanNullable(row.coaching_course_name);
      const phone = cleanNullable(row.phone);
      const employeeNo = cleanNullable(row.employee_no);
      const jobTitle = cleanNullable(row.job_title);
      const memo = cleanNullable(row.memo);

      console.log("[upload-coachees] ROW_START", rowIndex, email);

      if (!name || !email || !organization || !department || !position) {
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          error_code: "REQUIRED_FIELD_MISSING",
          message: "name, email, organization, department, position은 필수입니다.",
        });
        continue;
      }

      if (!isEmail(email)) {
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

      console.log("[upload-coachees] COACHEE_LOOKUP_START", email);

      const { data: existingCoachees, error: lookupError } =
        await supabaseAdmin
          .from("coachees")
          .select("id, name, email")
          .eq("client_id", clientId)
          .eq("email", email)
          .limit(1);

      if (lookupError) {
        console.error("[upload-coachees] COACHEE_LOOKUP_ERROR", lookupError);
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          error_code: "COACHEE_LOOKUP_FAILED",
          message: lookupError.message,
        });
        continue;
      }

      let coacheeId = existingCoachees?.[0]?.id ?? null;
      let coacheeStatus: "created" | "updated_existing" = "updated_existing";

      if (coacheeId) {
        console.log("[upload-coachees] COACHEE_EXISTS", coacheeId);

        const { error: updateError } = await supabaseAdmin
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

        if (updateError) {
          console.error("[upload-coachees] COACHEE_UPDATE_ERROR", updateError);
          results.push({
            row_index: rowIndex,
            email,
            name,
            status: "error",
            error_code: "COACHEE_UPDATE_FAILED",
            message: updateError.message,
          });
          continue;
        }
      } else {
        console.log("[upload-coachees] COACHEE_INSERT_START", email);

        const { data: insertedCoachee, error: insertError } =
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

        if (insertError || !insertedCoachee) {
          console.error("[upload-coachees] COACHEE_INSERT_ERROR", insertError);
          results.push({
            row_index: rowIndex,
            email,
            name,
            status: "error",
            error_code: "COACHEE_CREATE_FAILED",
            message: insertError?.message ?? "coachee insert failed",
          });
          continue;
        }

        coacheeId = insertedCoachee.id;
        coacheeStatus = "created";

        console.log("[upload-coachees] COACHEE_INSERT_OK", coacheeId);
      }

      console.log("[upload-coachees] PROJECT_COACHEE_LOOKUP_START", coacheeId);

      const { data: existingProjectCoachees, error: pcLookupError } =
        await supabaseAdmin
          .from("project_coachees")
          .select("id")
          .eq("project_id", projectId)
          .eq("coachee_id", coacheeId)
          .limit(1);

      if (pcLookupError) {
        console.error("[upload-coachees] PC_LOOKUP_ERROR", pcLookupError);
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          coachee_id: coacheeId,
          error_code: "PROJECT_COACHEE_LOOKUP_FAILED",
          message: pcLookupError.message,
        });
        continue;
      }

      const existingProjectCoacheeId = existingProjectCoachees?.[0]?.id ?? null;

      if (existingProjectCoacheeId) {
        console.log("[upload-coachees] PROJECT_COACHEE_EXISTS", existingProjectCoacheeId);

        const { error: pcUpdateError } = await supabaseAdmin
          .from("project_coachees")
          .update({
            coaching_course_name: coachingCourseName,
            memo,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingProjectCoacheeId);

        if (pcUpdateError) {
          console.error("[upload-coachees] PC_UPDATE_ERROR", pcUpdateError);
          results.push({
            row_index: rowIndex,
            email,
            name,
            status: "error",
            coachee_id: coacheeId,
            project_coachee_id: existingProjectCoacheeId,
            error_code: "PROJECT_COACHEE_UPDATE_FAILED",
            message: pcUpdateError.message,
          });
          continue;
        }

        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "skipped",
          coachee_id: coacheeId,
          project_coachee_id: existingProjectCoacheeId,
          message: "이미 프로젝트에 등록된 피코치입니다. 기본정보만 보정했습니다.",
        });

        continue;
      }

      console.log("[upload-coachees] PROJECT_COACHEE_INSERT_START");

      const { data: insertedPc, error: pcInsertError } = await supabaseAdmin
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

      if (pcInsertError || !insertedPc) {
        console.error("[upload-coachees] PC_INSERT_ERROR", pcInsertError);
        results.push({
          row_index: rowIndex,
          email,
          name,
          status: "error",
          coachee_id: coacheeId,
          error_code: "PROJECT_COACHEE_CREATE_FAILED",
          message: pcInsertError?.message ?? "project_coachee insert failed",
        });
        continue;
      }

      console.log("[upload-coachees] PROJECT_COACHEE_INSERT_OK", insertedPc.id);

      results.push({
        row_index: rowIndex,
        email,
        name,
        status: coacheeStatus,
        coachee_id: coacheeId,
        project_coachee_id: insertedPc.id,
        message: coacheeStatus === "created"
          ? "피코치가 생성되고 프로젝트에 등록되었습니다."
          : "기존 피코치를 프로젝트에 연결했습니다.",
      });
    }

    const created = results.filter((r) => r.status === "created").length;
    const updatedExisting = results.filter((r) =>
      r.status === "updated_existing"
    ).length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log("[upload-coachees] FINISH", {
      total: rows.length,
      created,
      updatedExisting,
      skipped,
      errors,
    });

    return okResponse(
      {
        project,
        summary: {
          total: rows.length,
          created,
          updated_existing: updatedExisting,
          skipped,
          errors,
          success_count: created + updatedExisting,
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
    console.error("[upload-coachees] FATAL_ERROR", message);

    if (message === "UNAUTHORIZED") {
      return errorResponse("UNAUTHORIZED", "로그인이 필요합니다.", 401);
    }

    if (message === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "피코치 업로드 권한이 없습니다.", 403);
    }

    return errorResponse(
      "UPLOAD_COACHEES_FAILED",
      "피코치 업로드 처리 중 오류가 발생했습니다.",
      500,
      { raw_message: message },
    );
  }
});