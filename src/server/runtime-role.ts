/** Fixed SQL, never constructed from request input. Membership in an owner or
 * bypass role is unsafe even when the current login itself is NOBYPASSRLS. */
export const runtimeRoleSafetySql = `
  select (
    not rolsuper and not rolbypassrls
    and pg_has_role(current_user, 'tarbiyah_runtime', 'member')
    and not exists (
      select 1 from pg_roles privileged
      where (privileged.rolsuper or privileged.rolbypassrls)
        and pg_has_role(current_user, privileged.oid, 'member')
    )
    and not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and pg_has_role(current_user,c.relowner,'member')
    )
  ) as safe from pg_roles where rolname=current_user
`;
