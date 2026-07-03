// supabase/functions/generate-participant-codes/index.ts

import { handleOptions } from "../_shared/cors.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";
import {
  getCurrentUserContext,
  requireAnyRole,
} from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type GenerateRequest = {
  project_coachee_ids?: string[];
};

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function makeParticipantCode(clientCode: string, number: number): string {
  return `${clientCode}${String(number).padStart(3, "0")}`;
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
    console.log("[generate-participant-codes] START - v2 client_id fixed");

    const ctx = await getCurrentUserContext(req);
    console.log("[generate-participant-codes] AUTH_OK", ctx.email, ctx.roles);

    requireAnyRole(ctx, ["system_admin", "operator"]);

    const body = await req.json() as GenerateRequest;

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

    const { data: rows, error: lookupError } = await supabaseAdmin
      .from("project_coachees")
      .select(`
        id,
        project_id,
        coachee_id,
        onboarding_status,
        participant_id,
        participant_code,
        survey_token,
        coaching_projects (
          id,
          client_id,
          project_name,
          participant_code_rule,
          clients (
            id,
            client_code,
            client_name
          )
        ),
        coachees (
          id,
          name,
          email,
          organization,
          department,
          position
        )
      `)
      .in("id", ids);

    if (lookupError) {
      console.error("[generate-participant-codes] LOOKUP_ERROR", lookupError);
      return errorResponse(
        "LOOKUP_FAILED",
        "참여코드 생성 대상 조회 중 오류가 발생했습니다.",
        500,
        { raw_message: lookupError.message },
      );
    }

    const foundIds = new Set((rows ?? []).map((row) => row.id));
    const notFoundIds = ids.filter((id) => !foundIds.has(id));

    if (notFoundIds.length > 0) {
      return errorResponse(
        "TARGET_NOT_FOUND",
        "일부 대상이 존재하지 않습니다.",
        404,
        { not_found_ids: notFoundIds },
      );
    }

    const results = [];

    for (const row of rows ?? []) {
      console.log("[generate-participant-codes] ROW_START", row.id);

      if (row.onboarding_status !== "approved") {
        results.push({
          project_coachee_id: row.id,
          status: "error",
          error_code: "NOT_APPROVED",
          message: "승인된 피코치만 참여코드를 생성할 수 있습니다.",
        });
        continue;
      }

      if (row.participant_id && row.participant_code && row.survey_token) {
        results.push({
          project_coachee_id: row.id,
          status: "skipped",
          participant_id: row.participant_id,
          participant_code: row.participant_code,
          survey_token: row.survey_token,
          message: "이미 참여코드가 생성되어 있습니다.",
        });
        continue;
      }

      const project = Array.isArray(row.coaching_projects)
        ? row.coaching_projects[0]
        : row.coaching_projects;

      const coachee = Array.isArray(row.coachees)
        ? row.coachees[0]
        : row.coachees;

      if (!project) {
        results.push({
          project_coachee_id: row.id,
          status: "error",
          error_code: "PROJECT_NOT_FOUND",
          message: "연결된 프로젝트를 찾을 수 없습니다.",
        });
        continue;
      }

      if (!coachee) {
        results.push({
          project_coachee_id: row.id,
          status: "error",
          error_code: "COACHEE_NOT_FOUND",
          message: "연결된 피코치를 찾을 수 없습니다.",
        });
        continue;
      }

      const client = Array.isArray(project.clients)
        ? project.clients[0]
        : project.clients;

      const clientId = project.client_id;
      const clientCode = client?.client_code;

      console.log("[generate-participant-codes] CLIENT_INFO", {
        clientId,
        clientCode,
      });

      if (!clientId) {
        results.push({
          project_coachee_id: row.id,
          status: "error",
          error_code: "CLIENT_ID_MISSING",
          message: "프로젝트에 client_id가 없습니다.",
        });
        continue;
      }

      if (!clientCode) {
        results.push({
          project_coachee_id: row.id,
          status: "error",
          error_code: "CLIENT_CODE_MISSING",
          message: "고객사 client_code가 없습니다.",
        });
        continue;
      }

      const prefix = clientCode;

const { data: counterRow, error: counterLookupError } =
  await supabaseAdmin
    .from("participant_code_counters")
    .select("id, client_id, client_code, prefix, last_number")
    .eq("client_id", clientId)
    .eq("prefix", prefix)
    .maybeSingle();

      if (counterLookupError) {
        console.error(
          "[generate-participant-codes] COUNTER_LOOKUP_ERROR",
          counterLookupError,
        );

        results.push({
          project_coachee_id: row.id,
          status: "error",
          error_code: "COUNTER_LOOKUP_FAILED",
          message: counterLookupError.message,
        });
        continue;
      }

      let nextNumber = 1;

      if (!counterRow) {
        console.log("[generate-participant-codes] COUNTER_CREATE_START", {
          clientId,
          clientCode,
          lastNumber: 1,
        });

        const { data: insertedCounter, error: counterInsertError } =
          await supabaseAdmin
            .from("participant_code_counters")
            .insert({
              client_id: clientId,
              client_code: clientCode,
              last_number: 1,
            })
            .select("id, client_id, client_code, last_number")
            .single();

        if (counterInsertError || !insertedCounter) {
          console.error(
            "[generate-participant-codes] COUNTER_CREATE_ERROR",
            counterInsertError,
          );

          results.push({
            project_coachee_id: row.id,
            status: "error",
            error_code: "COUNTER_CREATE_FAILED",
            message: counterInsertError?.message ?? "counter insert failed",
          });
          continue;
        }

        nextNumber = insertedCounter.last_number;
      } else {
        nextNumber = Number(counterRow.last_number ?? 0) + 1;

        console.log("[generate-participant-codes] COUNTER_UPDATE_START", {
          counterId: counterRow.id,
          before: counterRow.last_number,
          nextNumber,
        });

        const { error: counterUpdateError } = await supabaseAdmin
  .from("participant_code_counters")
  .update({
    client_code: clientCode,
    prefix,
    last_number: nextNumber,
    updated_at: new Date().toISOString(),
  })
  .eq("id", counterRow.id); 

        if (counterUpdateError) {
          console.error(
            "[generate-participant-codes] COUNTER_UPDATE_ERROR",
            counterUpdateError,
          );

          results.push({
            project_coachee_id: row.id,
            status: "error",
            error_code: "COUNTER_UPDATE_FAILED",
            message: counterUpdateError.message,
          });
          continue;
        }
      }

      const participantCode = makeParticipantCode(clientCode, nextNumber);
      const surveyToken = randomToken();

      console.log("[generate-participant-codes] PARTICIPANT_CREATE_START", {
        participantCode,
        coacheeEmail: coachee.email,
      });

      const { data: insertedParticipant, error: participantInsertError } =
        await supabaseAdmin
          .from("participants")
          .insert({
            participant_code: participantCode,
            survey_token: surveyToken,
            name: coachee.name,
            email: coachee.email,
            organization: coachee.organization,
            department: coachee.department,
            position: coachee.position,
            status: "active",
          })
          .select("id, participant_code, survey_token")
          .single();

      if (participantInsertError || !insertedParticipant) {
        console.error(
          "[generate-participant-codes] PARTICIPANT_INSERT_ERROR",
          participantInsertError,
        );

        results.push({
          project_coachee_id: row.id,
          status: "error",
          error_code: "PARTICIPANT_CREATE_FAILED",
          participant_code: participantCode,
          message: participantInsertError?.message ?? "participant insert failed",
        });
        continue;
      }

      const now = new Date().toISOString();

      const { data: updatedPc, error: pcUpdateError } = await supabaseAdmin
        .from("project_coachees")
        .update({
          participant_id: insertedParticipant.id,
          participant_code: insertedParticipant.participant_code,
          survey_token: insertedParticipant.survey_token,
          updated_at: now,
        })
        .eq("id", row.id)
        .select(`
          id,
          project_id,
          coachee_id,
          onboarding_status,
          participant_id,
          participant_code,
          survey_token,
          diagnosis_status,
          needs_status,
          report_status
        `)
        .single();

      if (pcUpdateError || !updatedPc) {
        console.error(
          "[generate-participant-codes] PROJECT_COACHEE_UPDATE_ERROR",
          pcUpdateError,
        );

        results.push({
          project_coachee_id: row.id,
          status: "error",
          error_code: "PROJECT_COACHEE_UPDATE_FAILED",
          participant_id: insertedParticipant.id,
          participant_code: insertedParticipant.participant_code,
          message: pcUpdateError?.message ?? "project_coachee update failed",
        });
        continue;
      }

      results.push({
        project_coachee_id: row.id,
        status: "created",
        participant_id: insertedParticipant.id,
        participant_code: insertedParticipant.participant_code,
        survey_token: insertedParticipant.survey_token,
        survey_url:
          `https://coachingmate.co.kr/?id=${insertedParticipant.participant_code}`,
        message: "참여코드와 설문 토큰이 생성되었습니다.",
      });
    }

    const created = results.filter((r) => r.status === "created").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log("[generate-participant-codes] FINISH", {
      requested_count: ids.length,
      created,
      skipped,
      errors,
    });

    return okResponse(
      {
        summary: {
          requested_count: ids.length,
          created,
          skipped,
          errors,
          success_count: created,
        },
        results,
        processed_by: {
          profile_id: ctx.profileId,
          email: ctx.email,
          roles: ctx.roles,
        },
      },
      "참여코드 생성 처리가 완료되었습니다.",
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error("[generate-participant-codes] FATAL_ERROR", message);

    if (message === "UNAUTHORIZED") {
      return errorResponse("UNAUTHORIZED", "로그인이 필요합니다.", 401);
    }

    if (message === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "참여코드 생성 권한이 없습니다.", 403);
    }

    return errorResponse(
      "GENERATE_PARTICIPANT_CODES_FAILED",
      "참여코드 생성 처리 중 오류가 발생했습니다.",
      500,
      { raw_message: message },
    );
  }
});