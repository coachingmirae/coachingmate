# CoachingMate Edge Function + Login Test Package

## 포함 파일

```text
supabase/functions/_shared/cors.ts
supabase/functions/_shared/response.ts
supabase/functions/_shared/supabaseAdmin.ts
supabase/functions/_shared/auth.ts
supabase/functions/whoami/index.ts
supabase/functions/create-client/index.ts
frontend/login-test.html
```

## 사용 순서

1. 압축을 풀고 프로젝트 루트에 `supabase/functions` 폴더를 복사합니다.
2. Supabase CLI로 배포합니다.

```bash
supabase functions deploy whoami
supabase functions deploy create-client
```

3. Supabase Dashboard에서 Edge Function 환경변수를 확인합니다.
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY

4. `frontend/login-test.html` 파일을 열고 다음 2개 값을 실제 값으로 수정합니다.
   - SUPABASE_URL
   - SUPABASE_ANON_KEY

5. 페이지에서 `coachingmirae@gmail.com`으로 로그인 후 `whoami 호출` 버튼을 누릅니다.

정상 응답에는 다음 정보가 들어 있어야 합니다.

```json
{
  "ok": true,
  "data": {
    "auth_user_id": "...",
    "profile_id": "...",
    "email": "coachingmirae@gmail.com",
    "roles": ["operator", "system_admin"]
  }
}
```
