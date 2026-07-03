// supabase/functions/reject-coachees/index.ts

import { handleOptions } from "../_shared/cors.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";
import {
  getCurrentUserContext,
  requireAnyRole,
} from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type RejectRequest = {
  project_coachee_ids?: string[];
  reject_reason?: string;
};

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
    console.log("[reject-coachees] START");

    const ctx = await getCurrentUserContext(req);
    console.log("[reject-coachees] AUTH_OK", ctx.email, ctx.roles);

    requireAnyRole(ctx, ["system_admin", "operator"]);

    const body = await req.json() as RejectRequest;

    const ids = Array.isArray(body.project_coachee_ids)
      ? body.project_coachee_ids.map(cleanId).filter((id) => id.length > 0)
      : [];

    const rejectReason = cleanText(body.reject_reason);

    if (ids.length === 0) {
      return errorResponse(
        "VALIDATION_ERROR",
        "project_coachee_ids는 필수값입니다.",
        400,
      );
    }

    if (!rejectReason) {
      return errorResponse(
        "VALIDATION_ERROR",
        "reject_reason은 필수값입니다.",
        400,
      );
    }

    console.log("[reject-coachees] TARGET_IDS", ids);

    const { data: existingRows, error: lookupError } = await supabaseAdmin
      .from("project_coachees")
      .select(`
        id,
        project_id,
        coachee_id,
        onboarding_status,
        approved_by,
        approved_at,
        reject_reason,
        coachees (
          id,
          name,
          email
        )
      `)
      .in("id", ids);

    if (lookupError) {
      console.error("[reject-coachees] LOOKUP_ERROR", lookupError);

      return errorResponse(
        "LOOKUP_FAILED",
        "반려 대상 조회 중 오류가 발생했습니다.",
        500,
        { raw_message: lookupError.message },
      );
    }

    const foundIds = new Set((existingRows ?? []).map((row) => row.id));
    const notFoundIds = ids.filter((id) => !foundIds.has(id));

    if (notFoundIds.length > 0) {
      return errorResponse(
        "TARGET_NOT_FOUND",
        "일부 반려 대상이 존재하지 않습니다.",
        404,
        { not_found_ids: notFoundIds },
      );
    }

    const now = new Date().toISOString();

    const { data: updatedRows, error: updateError } = await supabaseAdmin
      .from("project_coachees")
      .update({
        onboarding_status: "rejected",
        reject_reason: rejectReason,
        approved_by: null,
        approved_at: null,
        updated_at: now,
      })
      .in("id", ids)
      .select(`
        id,
        project_id,
        coachee_id,
        onboarding_status,
        approved_by,
        approved_at,
        reject_reason,
        diagnosis_status,
        needs_status,
        report_status,
        coachees (
          id,
          name,
          email
        )
      `);

    if (updateError) {
      console.error("[reject-coachees] UPDATE_ERROR", updateError);

      return errorResponse(
        "REJECT_FAILED",
        "피코치 반려 처리 중 오류가 발생했습니다.",
        500,
        { raw_message: updateError.message },
      );
    }

    console.log("[reject-coachees] FINISH", {
      requested_count: ids.length,
      rejected_count: updatedRows?.length ?? 0,
    });

    return okResponse(
      {
        summary: {
          requested_count: ids.length,
          rejected_count: updatedRows?.length ?? 0,
        },
        rejected: updatedRows ?? [],
        before: existingRows ?? [],
        processed_by: {
          profile_id: ctx.profileId,
          email: ctx.email,
          roles: ctx.roles,
        },
      },
      "피코치 반려 처리가 완료되었습니다.",
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error("[reject-coachees] FATAL_ERROR", message);

    if (message === "UNAUTHORIZED") {
      return errorResponse("UNAUTHORIZED", "로그인이 필요합니다.", 401);
    }

    if (message === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "피코치 반려 권한이 없습니다.", 403);
    }

    return errorResponse(
      "REJECT_COACHEES_FAILED",
      "피코치 반려 처리 중 오류가 발생했습니다.",
      500,
      { raw_message: message },
    );
  }
});