// supabase/functions/create-client/index.ts

import { handleOptions } from "../_shared/cors.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";
import {
  getCurrentUserContext,
  requireAnyRole,
} from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type CreateClientRequest = {
  client_name?: string;
  display_name?: string | null;
  client_code?: string;
  business_number?: string | null;
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

function validateClientCode(clientCode: string): boolean {
  return /^[a-z0-9-]+$/.test(clientCode);
}

Deno.serve(async (req: Request) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "POST 방식으로 호출해야 합니다.", 405);
  }

  try {
    const ctx = await getCurrentUserContext(req);
    requireAnyRole(ctx, ["system_admin", "operator"]);

    let body: CreateClientRequest;
    try {
      body = await req.json();
    } catch (_error) {
      return errorResponse("INVALID_JSON", "요청 본문이 올바른 JSON 형식이 아닙니다.", 400);
    }

    const clientName = normalizeText(body.client_name);
    const displayName = normalizeNullableText(body.display_name) ?? clientName;
    const clientCode = normalizeText(body.client_code).toLowerCase();
    const businessNumber = normalizeNullableText(body.business_number);
    const memo = normalizeNullableText(body.memo);

    if (!clientName) {
      return errorResponse("VALIDATION_ERROR", "client_name은 필수값입니다.", 400);
    }

    if (!clientCode) {
      return errorResponse("VALIDATION_ERROR", "client_code는 필수값입니다.", 400);
    }

    if (!validateClientCode(clientCode)) {
      return errorResponse(
        "VALIDATION_ERROR",
        "client_code는 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.",
        400,
        { allowed_pattern: "^[a-z0-9-]+$" },
      );
    }

    const { data: existingClient, error: existingError } = await supabaseAdmin
      .from("clients")
      .select("id, client_name, client_code")
      .eq("client_code", clientCode)
      .maybeSingle();

    if (existingError) {
      return errorResponse(
        "CLIENT_LOOKUP_FAILED",
        "고객사 중복 확인 중 오류가 발생했습니다.",
        500,
        { raw_message: existingError.message },
      );
    }

    if (existingClient) {
      return errorResponse(
        "DUPLICATE_CLIENT_CODE",
        "이미 사용 중인 client_code입니다.",
        409,
        {
          client_id: existingClient.id,
          client_code: existingClient.client_code,
          client_name: existingClient.client_name,
        },
      );
    }

    const { data: insertedClient, error: insertError } = await supabaseAdmin
      .from("clients")
      .insert({
        client_name: clientName,
        display_name: displayName,
        client_code: clientCode,
        business_number: businessNumber,
        status: "active",
        memo,
      })
      .select("id, client_name, display_name, client_code, business_number, status, memo, created_at")
      .single();

    if (insertError) {
      return errorResponse(
        "CLIENT_CREATE_FAILED",
        "고객사 등록 중 오류가 발생했습니다.",
        500,
        { raw_message: insertError.message },
      );
    }

    return okResponse(
      {
        client: insertedClient,
        created_by: {
          profile_id: ctx.profileId,
          email: ctx.email,
          roles: ctx.roles,
        },
      },
      "고객사가 등록되었습니다.",
      201,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (message === "UNAUTHORIZED") return errorResponse("UNAUTHORIZED", "로그인이 필요합니다.", 401);
    if (message === "FORBIDDEN") return errorResponse("FORBIDDEN", "고객사 등록 권한이 없습니다.", 403);
    if (message === "PROFILE_NOT_FOUND") return errorResponse("PROFILE_NOT_FOUND", "user_profiles에 연결된 사용자 정보가 없습니다.", 404);
    if (message === "PROFILE_LOOKUP_FAILED") return errorResponse("PROFILE_LOOKUP_FAILED", "사용자 프로필 조회 중 오류가 발생했습니다.", 500);
    if (message === "ROLES_LOOKUP_FAILED") return errorResponse("ROLES_LOOKUP_FAILED", "사용자 역할 조회 중 오류가 발생했습니다.", 500);
    if (message === "SERVER_ENV_ERROR") return errorResponse("SERVER_ENV_ERROR", "서버 환경변수가 설정되지 않았습니다.", 500);

    return errorResponse("UNKNOWN_ERROR", "알 수 없는 오류가 발생했습니다.", 500, {
      raw_message: message,
    });
  }
});
