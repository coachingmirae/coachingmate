// supabase/functions/handle-new-submission/index.ts
//
// CoachingMate 신규 제출 자동 처리 Edge Function
//
// 역할:
// 1. Supabase Database Webhook에서 submissions INSERT payload 수신
// 2. Google Apps Script Web App으로 Google Sheet 적재 요청
// 3. Apps Script가 보낸 이메일 결과를 submission_notification_logs에 기록
// 4. 중복 Webhook 호출 시 Google Sheet/이메일 중복 처리 방지
//
// 배포 예:
// supabase functions deploy handle-new-submission --no-verify-jwt
//
// Database Webhook URL 예:
// https://<PROJECT_REF>.supabase.co/functions/v1/handle-new-submission?token=<EDGE_WEBHOOK_TOKEN>

import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

type SubmissionRecord = {
  id: string;
  submitted_at: string;
  participant_code: string;
  basic_info?: JsonObject;
  leadership_answers?: JsonObject;
  needs_answers?: JsonObject;
  raw_payload?: JsonObject;
};

type RecipientRow = {
  email: string;
  name?: string | null;
  role?: string | null;
  is_active?: boolean | null;
};

type EmailResult = {
  email: string;
  status: "sent" | "failed" | "skipped";
  error_message?: string;
};

function jsonResponse(body: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function getTokenFromRequest(req: Request): string {
  const url = new URL(req.url);

  return (
    url.searchParams.get("token") ||
    req.headers.get("x-coachingmate-token") ||
    ""
  );
}

function verifyRequestToken(req: Request): void {
  const expectedToken = getRequiredEnv("EDGE_WEBHOOK_TOKEN");
  const receivedToken = getTokenFromRequest(req);

  if (!receivedToken || receivedToken !== expectedToken) {
    throw new Error("Invalid Edge webhook token.");
  }
}

function normalizeSubmissionPayload(payload: JsonObject): SubmissionRecord {
  const record = (payload.record || payload) as Partial<SubmissionRecord>;

  if (!record || typeof record !== "object") {
    throw new Error("Submission record is missing.");
  }

  if (!record.id) {
    throw new Error("record.id is missing.");
  }

  if (!record.participant_code) {
    throw new Error("record.participant_code is missing.");
  }

  if (!record.submitted_at) {
    throw new Error("record.submitted_at is missing.");
  }

  return {
    id: String(record.id),
    submitted_at: String(record.submitted_at),
    participant_code: String(record.participant_code),
    basic_info: (record.basic_info || {}) as JsonObject,
    leadership_answers: (record.leadership_answers || {}) as JsonObject,
    needs_answers: (record.needs_answers || {}) as JsonObject,
    raw_payload: (record.raw_payload || record || {}) as JsonObject,
  };
}

function isSubmissionInsertWebhook(payload: JsonObject): boolean {
  const tableName = String(payload.table || "");
  const eventType = String(payload.type || payload.eventType || "");

  if (!tableName && !eventType) {
    // 직접 테스트 payload는 허용
    return true;
  }

  return tableName === "submissions" && eventType.toUpperCase() === "INSERT";
}

async function fetchActiveRecipients(supabase: ReturnType<typeof createClient>): Promise<RecipientRow[]> {
  const { data, error } = await supabase
    .from("admin_notification_recipients")
    .select("email, name, role, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []) as RecipientRow[];
}

async function fetchSentEmailSet(
  supabase: ReturnType<typeof createClient>,
  submissionId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("submission_notification_logs")
    .select("recipient_email")
    .eq("submission_id", submissionId)
    .eq("notification_type", "new_submission")
    .eq("status", "sent");

  if (error) {
    throw error;
  }

  const sent = new Set<string>();

  for (const row of data || []) {
    const email = String(row.recipient_email || "").trim().toLowerCase();

    if (email) {
      sent.add(email);
    }
  }

  return sent;
}

function buildAppsScriptUrl(): string {
  const baseUrl = getRequiredEnv("GOOGLE_APPS_SCRIPT_WEBAPP_URL");
  const token = getRequiredEnv("COACHINGMATE_WEBHOOK_TOKEN");
  const separator = baseUrl.includes("?") ? "&" : "?";

  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
}

async function callAppsScript(
  submission: SubmissionRecord,
  recipients: RecipientRow[],
): Promise<JsonObject> {
  const url = buildAppsScriptUrl();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      record: submission,
      notification_recipients: recipients,
    }),
  });

  const responseText = await response.text();

  let parsed: JsonObject = {};

  try {
    parsed = JSON.parse(responseText);
  } catch (_error) {
    parsed = {
      ok: false,
      status: "invalid_json_response",
      raw_response: responseText,
    };
  }

  if (!response.ok) {
    throw new Error(
      `Apps Script HTTP ${response.status}: ${responseText.slice(0, 1000)}`,
    );
  }

  if (parsed.ok !== true) {
    throw new Error(
      `Apps Script error: ${JSON.stringify(parsed).slice(0, 1000)}`,
    );
  }

  return parsed;
}

async function upsertNotificationLog(
  supabase: ReturnType<typeof createClient>,
  submission: SubmissionRecord,
  emailResult: EmailResult,
): Promise<void> {
  const payload = {
    submission_id: submission.id,
    participant_code: submission.participant_code,
    submitted_at: submission.submitted_at,
    recipient_email: emailResult.email,
    notification_type: "new_submission",
    status: emailResult.status === "sent" ? "sent" : "failed",
    error_message: emailResult.error_message || null,
    sent_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("submission_notification_logs")
    .upsert(payload, {
      onConflict: "submission_id,recipient_email,notification_type",
    });

  if (error) {
    throw error;
  }
}

function extractEmailResults(appsScriptResult: JsonObject): EmailResult[] {
  const rawResults = appsScriptResult.email_results;

  if (!Array.isArray(rawResults)) {
    return [];
  }

  return rawResults
    .map((item) => {
      const row = item as JsonObject;

      return {
        email: String(row.email || ""),
        status: String(row.status || "failed") as EmailResult["status"],
        error_message: row.error_message
          ? String(row.error_message)
          : undefined,
      };
    })
    .filter((row) => row.email);
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return jsonResponse({
        ok: true,
        service: "CoachingMate handle-new-submission",
        status: "ready",
      });
    }

    verifyRequestToken(req);

    const payload = await req.json() as JsonObject;

    if (!isSubmissionInsertWebhook(payload)) {
      return jsonResponse({
        ok: true,
        status: "ignored",
        reason: "not submissions INSERT event",
      });
    }

    const submission = normalizeSubmissionPayload(payload);

    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    const activeRecipients = await fetchActiveRecipients(supabase);
    const sentEmailSet = await fetchSentEmailSet(supabase, submission.id);

    const recipientsToNotify = activeRecipients.filter((recipient) => {
      const email = String(recipient.email || "").trim().toLowerCase();

      return email && !sentEmailSet.has(email);
    });

    const appsScriptResult = await callAppsScript(
      submission,
      recipientsToNotify,
    );

    const emailResults = extractEmailResults(appsScriptResult);

    for (const emailResult of emailResults) {
      await upsertNotificationLog(supabase, submission, emailResult);
    }

    return jsonResponse({
      ok: true,
      status: "processed",
      participant_code: submission.participant_code,
      submitted_at: submission.submitted_at,
      active_recipient_count: activeRecipients.length,
      recipients_to_notify_count: recipientsToNotify.length,
      apps_script_status: appsScriptResult.status || "",
      sheet_status: appsScriptResult.sheet_status || appsScriptResult.status || "",
      email_result_count: emailResults.length,
      email_results: emailResults,
    });

  } catch (error) {
    console.error(error);

    return jsonResponse({
      ok: false,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
