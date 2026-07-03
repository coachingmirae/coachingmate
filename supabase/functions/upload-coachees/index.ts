// supabase/functions/upload-coachees/index.ts

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
        ping: "upload-coachees alive",
        profile_id: ctx.profileId,
        email: ctx.email,
        roles: ctx.roles,
      },
      "upload-coachees ping 성공",
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    return errorResponse(
      "PING_FAILED",
      "upload-coachees ping 실패",
      500,
      { raw_message: message },
    );
  }
});