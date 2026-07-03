// supabase/functions/approve-coachees/index.ts

import { handleOptions } from "../_shared/cors.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";
import {
  getCurrentUserContext,
  requireAnyRole,
} from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type ApproveRequest = {
  project_coachee_ids?: string[];
};

function cleanId(value: unknown): string {
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
    console.log("[approve-coachees] START");

    const ctx = await getCurrentUserContext(req);
    console.log("[approve-coachees] AUTH_OK", ctx.email, ctx.roles);

    requireAnyRole(ctx, ["system_admin", "operator"]);

    const body = await req.json() as ApproveRequest;
    const ids = Array.isArray(body.project_coachee_ids)
      ? body.project_coachee_ids.map(cleanId).filter((id) => id.length > 0)
      : [];

    if (ids.length === 0) {
      return errorResponse(
        "VALIDATION_ERROR",
        "project_coachee_ids는 필수값입니다.",
        400,
      );
    }

    console.log("[approve-coachees] TARGET_IDS", ids);

    const { data: existingRows, error: lookupError } = await supabaseAdmin
      .from("project_coachees")
      .select(`
        id,
        project_id,
        coachee_id,
        onboarding_status,
        coachees (
          id,
          name,
          email
        )
      `)
      .in("id", ids);

    if (lookupError) {
      console.error("[approve-coachees] LOOKUP_ERROR", lookupError);

      return errorResponse(
        "LOOKUP_FAILED",
        "승인 대상 조회 중 오류가 발생했습니다.",
        500,
        { raw_message: lookupError.message },
      );
    }

    const foundIds = new Set((existingRows ?? []).map((row) => row.id));
    const notFoundIds = ids.filter((id) => !foundIds.has(id));

    if (notFoundIds.length > 0) {
      return errorResponse(
        "TARGET_NOT_FOUND",
        "일부 승인 대상이 존재하지 않습니다.",
        404,
        { not_found_ids: notFoundIds },
      );
    }

    const now = new Date().toISOString();

    const { data: updatedRows, error: updateError } = await supabaseAdmin
      .from("project_coachees")
      .update({
        onboarding_status: "approved",
        approved_by: ctx.profileId,
        approved_at: now,
        reject_reason: null,
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
      console.error("[approve-coachees] UPDATE_ERROR", updateError);

      return errorResponse(
        "APPROVE_FAILED",
        "피코치 승인 처리 중 오류가 발생했습니다.",
        500,
        { raw_message: updateError.message },
      );
    }

    console.log("[approve-coachees] FINISH", {
      requested_count: ids.length,
      approved_count: updatedRows?.length ?? 0,
    });

    return okResponse(
      {
        summary: {
          requested_count: ids.length,
          approved_count: updatedRows?.length ?? 0,
        },
        approved: updatedRows ?? [],
        before: existingRows ?? [],
        processed_by: {
          profile_id: ctx.profileId,
          email: ctx.email,
          roles: ctx.roles,
        },
      },
      "피코치 승인 처리가 완료되었습니다.",
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error("[approve-coachees] FATAL_ERROR", message);

    if (message === "UNAUTHORIZED") {
      return errorResponse("UNAUTHORIZED", "로그인이 필요합니다.", 401);
    }

    if (message === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "피코치 승인 권한이 없습니다.", 403);
    }

    return errorResponse(
      "APPROVE_COACHEES_FAILED",
      "피코치 승인 처리 중 오류가 발생했습니다.",
      500,
      { raw_message: message },
    );
  }
});