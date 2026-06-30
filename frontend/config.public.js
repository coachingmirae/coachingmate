// ============================================================
// config.public.js
// CoachingMate public frontend config
//
// 주의:
// - 이 파일은 브라우저에 공개되는 설정 파일입니다.
// - Supabase anon public key만 넣어야 합니다.
// - service_role key는 절대 넣으면 안 됩니다.
// ============================================================

(function () {
  "use strict";

  const CONFIG = {
    // Supabase Project URL
    SUPABASE_URL: "https://kvmhibfxysqnrfekiatf.supabase.co",

    // Supabase anon public key
    // Supabase Dashboard → Project Settings → API → Project API keys → anon public
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2bWhpYmZ4eXNxbnJmZWtpYXRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNTk5OTEsImV4cCI6MjA5NzkzNTk5MX0.lig9PP0rJy0O4dVUWllwDZEUN739c0bwvm9kBybfGtI",

    // CoachingMate 기본 설정
    APP_NAME: "CoachingMate",
    APP_SUBTITLE: "Leadership Coaching Platform",

    // 운영용 Google Sheet
    GOOGLE_SHEET_URL:
      "https://docs.google.com/spreadsheets/d/1BLuOy-hPyEZ0mYYvjjxQoy4YZu239kQuxTLnQCq1a8s/edit",

    // 관리자 페이지 기본 조회 개수
    ADMIN_DEFAULT_LIMIT: 100,
  };

  // ------------------------------------------------------------
  // 기존/신규 코드 호환용 alias
  // ------------------------------------------------------------

  window.COACHINGMATE_CONFIG = CONFIG;

  // 기존 페이지에서 다른 이름을 쓰고 있을 가능성 대비
  window.CM_CONFIG = CONFIG;
  window.SUPABASE_CONFIG = CONFIG;
  window.CoachingMateConfig = CONFIG;

  // 개별 전역 변수 방식 호환
  window.SUPABASE_URL = CONFIG.SUPABASE_URL;
  window.SUPABASE_ANON_KEY = CONFIG.SUPABASE_ANON_KEY;
})();