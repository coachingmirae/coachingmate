// CoachingMate common helpers
function cmGetParticipantCode() {
  const params = new URLSearchParams(window.location.search);
  const codeFromUrl = params.get("id");
  if (codeFromUrl && codeFromUrl.trim()) {
    const cleanCode = codeFromUrl.trim();
    localStorage.setItem("cm_participant_code", cleanCode);
    return cleanCode;
  }
  const savedCode = localStorage.getItem("cm_participant_code");
  return savedCode ? savedCode.trim() : "";
}

function cmGetSupabaseClient() {
  if (!window.CM_CONFIG) throw new Error("config.js가 로드되지 않았습니다.");
  if (!window.supabase) throw new Error("Supabase SDK가 로드되지 않았습니다.");
  return window.supabase.createClient(
    window.CM_CONFIG.SUPABASE_URL,
    window.CM_CONFIG.SUPABASE_ANON_KEY
  );
}

function cmClearLocalResponse() {
  localStorage.removeItem("cm_basic_info");
  localStorage.removeItem("cm_leadership_answers");
  localStorage.removeItem("cm_needs_answers");
  localStorage.removeItem("cm_final_submission");
  localStorage.removeItem("cm_current_step");
  localStorage.removeItem("cm_last_saved_at");
  localStorage.removeItem("cm_submitted_at");
}
