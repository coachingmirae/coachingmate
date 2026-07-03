// supabase/functions/whoami/index.ts

import { handleOptions } from "../_shared/cors.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";
import { getCurrentUserContext } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  try {
    const ctx = await getCurrentUserContext(req);

    return okResponse(
      {
        auth_user_id: ctx.authUserId,
        profile_id: ctx.profileId,
        email: ctx.email,
        roles: ctx.roles,
      },
      "현재 로그인 사용자 정보 조회 성공",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (message === "UNAUTHORIZED") {
      return errorResponse("UNAUTHORIZED", "로그인이 필요합니다.", 401);
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
      { raw_message: message },
    );
  }
});
