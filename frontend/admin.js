(function () {
  "use strict";

  const GOOGLE_SHEET_URL =
    "https://docs.google.com/spreadsheets/d/1BLuOy-hPyEZ0mYYvjjxQoy4YZu239kQuxTLnQCq1a8s/edit";

  const NEEDS_LABELS = {
    currentWork: "N00. 현재 주요 역할/업무",
    need1: "N01. 코칭을 통해 얻고 싶은 것",
    need2: "N02. 성공적인 코칭의 기준",
    need3: "N03. 다루고 싶은 리더십 주제",
    need4: "N04. 이상적인 리더상",
    need5: "N05. 현재 리더십 강점",
    need6: "N06. 개선하고 싶은 영역",
    need7: "N07. 조직/팀 문화 관련 이슈",
    need8: "N08. 목표 달성의 걸림돌",
    need9: "N09. 관계/소통 관련 피드백",
    need10: "N10. 구성원 육성의 어려움",
    need11: "N11. 추가 요청사항",
  };

  const LEADERSHIP_CODES = [
    "Q01", "Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q08",
    "Q09", "Q10", "Q11", "Q12", "Q13", "Q14", "Q15", "Q16",
    "Q17", "Q18", "Q19", "Q20", "Q21", "Q22", "Q23", "Q24",
    "Q25", "Q26", "Q27", "Q28", "Q29", "Q30", "Q31", "Q32",
  ];

  const NEEDS_ORDER = [
    "currentWork",
    "need1",
    "need2",
    "need3",
    "need4",
    "need5",
    "need6",
    "need7",
    "need8",
    "need9",
    "need10",
    "need11",
  ];

  let supabaseClient = null;
  let adminKey = "";
  let submissions = [];

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    const params = new URLSearchParams(window.location.search);
    adminKey = String(params.get("key") || "").trim();

    bindEvents();

    if (!adminKey) {
      showError(
        "관리자 키가 없습니다.\n\n접속 예:\n/admin.html?key=운영자키"
      );
      setLoadStatus("접근 차단");
      renderEmpty("관리자 키가 없어 조회할 수 없습니다.");
      return;
    }

    const config =
  window.COACHINGMATE_CONFIG ||
  window.CoachingMateConfig ||
  window.CM_CONFIG ||
  window.SUPABASE_CONFIG ||
  {};

const supabaseUrl =
  config.SUPABASE_URL ||
  config.supabaseUrl ||
  config.supabase_url ||
  "";

const supabaseAnonKey =
  config.SUPABASE_ANON_KEY ||
  config.supabaseAnonKey ||
  config.supabase_anon_key ||
  config.ANON_KEY ||
  "";

if (!supabaseUrl || !supabaseAnonKey) {
  showError(
    "config.public.js 설정을 찾을 수 없습니다.\n\n" +
    "확인 필요:\n" +
    "1. config.public.js 파일이 frontend 폴더에 있는지\n" +
    "2. SUPABASE_URL / SUPABASE_ANON_KEY 값이 들어 있는지\n" +
    "3. 설정 객체 이름이 COACHINGMATE_CONFIG, CM_CONFIG, SUPABASE_CONFIG 중 하나인지"
  );
  setLoadStatus("설정 오류");
  renderEmpty("Supabase 설정 오류");
  return;
}

    supabaseClient = window.supabase.createClient(
      config.SUPABASE_URL,
      config.SUPABASE_ANON_KEY
    );

    loadSubmissions();
  }

  function bindEvents() {
    const refreshBtn = document.getElementById("refreshBtn");
    const sheetBtn = document.getElementById("sheetBtn");
    const modalCloseBtn = document.getElementById("modalCloseBtn");
    const modalBackdrop = document.getElementById("detailModalBackdrop");

    if (refreshBtn) {
      refreshBtn.addEventListener("click", loadSubmissions);
    }

    if (sheetBtn) {
      sheetBtn.addEventListener("click", function () {
        window.open(GOOGLE_SHEET_URL, "_blank", "noopener,noreferrer");
      });
    }

    if (modalCloseBtn) {
      modalCloseBtn.addEventListener("click", closeModal);
    }

    if (modalBackdrop) {
      modalBackdrop.addEventListener("click", function (event) {
        if (event.target === modalBackdrop) {
          closeModal();
        }
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeModal();
      }
    });
  }

  async function loadSubmissions() {
    if (!supabaseClient || !adminKey) {
      return;
    }

    clearError();
    setLoadStatus("불러오는 중");
    setTableStatus("조회 중...");
    setRefreshDisabled(true);

    const tbody = document.getElementById("submissionTableBody");
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="10" class="empty">데이터를 불러오는 중입니다.</td></tr>';
    }

    try {
      const { data, error } = await supabaseClient.rpc(
        "get_admin_submissions",
        {
          p_admin_key: adminKey,
          p_limit: 100,
          p_offset: 0,
        }
      );

      if (error) {
        throw error;
      }

      submissions = Array.isArray(data) ? data : [];

      renderSummary(submissions);
      renderTable(submissions);

      setLoadStatus("정상");
      setTableStatus("총 " + submissions.length + "건");

    } catch (error) {
      const message = getErrorMessage(error);
      showError("제출 목록 조회 실패:\n" + message);
      setLoadStatus("오류");
      setTableStatus("조회 실패");
      renderEmpty("제출 목록을 불러오지 못했습니다.");
    } finally {
      setRefreshDisabled(false);
    }
  }

  function renderSummary(rows) {
    const total = rows.length;
    const completed = rows.filter(function (row) {
      return (
        Number(row.leadership_answer_count || 0) >= 32 &&
        Number(row.needs_answer_count || 0) >= 12
      );
    }).length;

    const latest = rows.length > 0 ? rows[0].submitted_at : "";

    setText("totalCount", String(total));
    setText("completedCount", String(completed));
    setText("latestSubmittedAt", latest ? formatDateTime(latest) : "-");
  }

  function renderTable(rows) {
    const tbody = document.getElementById("submissionTableBody");
    if (!tbody) {
      return;
    }

    if (!rows || rows.length === 0) {
      renderEmpty("제출 데이터가 없습니다.");
      return;
    }

    tbody.innerHTML = "";

    rows.forEach(function (row) {
      const tr = document.createElement("tr");

      const leadershipCount = Number(row.leadership_answer_count || 0);
      const needsCount = Number(row.needs_answer_count || 0);

      tr.appendChild(td(formatDateTime(row.submitted_at)));
      tr.appendChild(td(row.participant_code || ""));
      tr.appendChild(td(row.company || ""));
      tr.appendChild(td(row.name || ""));
      tr.appendChild(td(row.department || ""));
      tr.appendChild(td(row.position_title || ""));
      tr.appendChild(tdWithBadge(leadershipCount + " / 32", leadershipCount >= 32));
      tr.appendChild(tdWithBadge(needsCount + " / 12", needsCount >= 12));
      tr.appendChild(tdWithBadge(row.status || "submitted", true));

      const actionTd = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "detail-button";
      btn.textContent = "상세보기";
      btn.addEventListener("click", function () {
        openDetail(row.participant_code);
      });
      actionTd.appendChild(btn);
      tr.appendChild(actionTd);

      tbody.appendChild(tr);
    });
  }

  function renderEmpty(message) {
    const tbody = document.getElementById("submissionTableBody");
    if (!tbody) {
      return;
    }

    tbody.innerHTML =
      '<tr><td colspan="10" class="empty">' + escapeHtml(message) + "</td></tr>";

    setText("totalCount", "-");
    setText("completedCount", "-");
    setText("latestSubmittedAt", "-");
  }

  async function openDetail(participantCode) {
    if (!participantCode) {
      return;
    }

    openModal();
    setText("modalTitle", "제출 상세");
    setText("modalSubtitle", participantCode);
    setModalBody("상세 데이터를 불러오는 중입니다.");

    try {
      const { data, error } = await supabaseClient.rpc(
        "get_admin_submission_detail",
        {
          p_admin_key: adminKey,
          p_participant_code: participantCode,
        }
      );

      if (error) {
        throw error;
      }

      const detail = Array.isArray(data) && data.length > 0 ? data[0] : null;

      if (!detail) {
        setModalBody("상세 데이터를 찾을 수 없습니다.");
        return;
      }

      renderDetail(detail);

    } catch (error) {
      setModalBody(
        '<div class="error-box" style="display:block;">상세 조회 실패:\n' +
          escapeHtml(getErrorMessage(error)) +
          "</div>"
      );
    }
  }

  function renderDetail(detail) {
    const basic = detail.basic_info || {};
    const leadership = detail.leadership_answers || {};
    const needs = detail.needs_answers || {};

    setText(
      "modalTitle",
      (basic.name || detail.participant_code || "제출 상세") + " 상세"
    );
    setText(
      "modalSubtitle",
      "참여코드 " +
        (detail.participant_code || "") +
        " · " +
        formatDateTime(detail.submitted_at)
    );

    const html =
      '<section class="detail-section">' +
      "<h3>기본정보</h3>" +
      '<div class="kv-grid">' +
      kv("참여코드", detail.participant_code) +
      kv("제출일시", formatDateTime(detail.submitted_at)) +
      kv("성명", basic.name || "") +
      kv("회사", basic.company || "") +
      kv("부서", basic.department || "") +
      kv("직책/직위", basic.position || "") +
      kv("이메일", basic.email || "") +
      kv("휴대폰", basic.phone || "") +
      "</div>" +
      "</section>" +

      '<section class="detail-section">' +
      "<h3>리더십 진단 응답</h3>" +
      '<div class="answer-grid">' +
      LEADERSHIP_CODES.map(function (code) {
        return (
          '<div class="answer-item"><strong>' +
            escapeHtml(code) +
          '</strong><span> : ' +
            escapeHtml(valueOrDash(leadership[code])) +
          '</span></div>'
        );
      }).join("") +
      "</div>" +
      "</section>" +

      '<section class="detail-section">' +
      "<h3>코칭 니즈조사 응답</h3>" +
      '<div class="needs-list">' +
      NEEDS_ORDER.map(function (key) {
        return (
          '<div class="needs-item"><strong>' +
          escapeHtml(NEEDS_LABELS[key] || key) +
          "</strong><p>" +
          escapeHtml(valueOrDash(needs[key])) +
          "</p></div>"
        );
      }).join("") +
      "</div>" +
      "</section>";

    setModalBody(html);
  }

  function td(value) {
    const cell = document.createElement("td");
    cell.textContent = value == null ? "" : String(value);
    return cell;
  }

  function tdWithBadge(value, ok) {
    const cell = document.createElement("td");
    const span = document.createElement("span");
    span.className = ok ? "badge" : "badge warn";
    span.textContent = value == null ? "" : String(value);
    cell.appendChild(span);
    return cell;
  }

  function kv(label, value) {
    return (
      '<div class="kv-label">' +
      escapeHtml(label) +
      "</div>" +
      '<div class="kv-value">' +
      escapeHtml(valueOrDash(value)) +
      "</div>"
    );
  }

  function openModal() {
    const backdrop = document.getElementById("detailModalBackdrop");
    if (backdrop) {
      backdrop.style.display = "flex";
    }
  }

  function closeModal() {
    const backdrop = document.getElementById("detailModalBackdrop");
    if (backdrop) {
      backdrop.style.display = "none";
    }
  }

  function setModalBody(html) {
    const body = document.getElementById("modalBody");
    if (body) {
      body.innerHTML = html;
    }
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  }

  function setLoadStatus(value) {
    setText("loadStatus", value);
  }

  function setTableStatus(value) {
    setText("tableStatus", value);
  }

  function setRefreshDisabled(disabled) {
    const btn = document.getElementById("refreshBtn");
    if (btn) {
      btn.disabled = disabled;
    }
  }

  function showError(message) {
    const box = document.getElementById("errorBox");
    if (!box) {
      return;
    }

    box.textContent = message;
    box.style.display = "block";
  }

  function clearError() {
    const box = document.getElementById("errorBox");
    if (!box) {
      return;
    }

    box.textContent = "";
    box.style.display = "none";
  }

  function formatDateTime(value) {
    if (!value) {
      return "-";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function valueOrDash(value) {
    if (value === null || value === undefined || value === "") {
      return "-";
    }

    return String(value);
  }

  function getErrorMessage(error) {
    if (!error) {
      return "알 수 없는 오류";
    }

    if (error.message) {
      return error.message;
    }

    return String(error);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();