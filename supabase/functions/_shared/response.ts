// supabase/functions/_shared/response.ts

import { corsHeaders } from "./cors.ts";

export function okResponse(
  data: Record<string, unknown> = {},
  message = "처리되었습니다.",
  status = 200,
) {
  return new Response(
    JSON.stringify({
      ok: true,
      data,
      message,
    }),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}

export function errorResponse(
  error_code: string,
  message: string,
  status = 400,
  detail: Record<string, unknown> | null = null,
) {
  return new Response(
    JSON.stringify({
      ok: false,
      error_code,
      message,
      detail,
    }),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}
