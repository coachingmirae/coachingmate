// supabase/functions/_shared/auth.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { supabaseAdmin } from "./supabaseAdmin.ts";

export type CurrentUserContext = {
  authUserId: string;
  email: string | null;
  profileId: string;
  roles: string[];
};

export async function getCurrentUserContext(
  req: Request,
): Promise<CurrentUserContext> {
  const authHeader = req.headers.get("Authorization") ?? "";

  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("UNAUTHORIZED");
  }

  const token = authHeader.replace("Bearer ", "").trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    throw new Error("SERVER_ENV_ERROR");
  }

  const supabaseUserClient = createClient(
    supabaseUrl,
    anonKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  const {
    data: { user },
    error: userError,
  } = await supabaseUserClient.auth.getUser();

  if (userError || !user) {
    throw new Error("UNAUTHORIZED");
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select("id, email")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error("PROFILE_LOOKUP_FAILED");
  }

  if (!profile) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  const { data: rolesRows, error: rolesError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", profile.id)
    .eq("status", "active");

  if (rolesError) {
    throw new Error("ROLES_LOOKUP_FAILED");
  }

  const roles = (rolesRows ?? []).map((row) => row.role);

  return {
    authUserId: user.id,
    email: user.email ?? profile.email ?? null,
    profileId: profile.id,
    roles,
  };
}

export function hasAnyRole(
  ctx: CurrentUserContext,
  allowedRoles: string[],
): boolean {
  return ctx.roles.some((role) => allowedRoles.includes(role));
}

export function requireAnyRole(
  ctx: CurrentUserContext,
  allowedRoles: string[],
) {
  if (!hasAnyRole(ctx, allowedRoles)) {
    throw new Error("FORBIDDEN");
  }
}
