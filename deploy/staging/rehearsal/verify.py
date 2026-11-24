"""Exercise the deployment CLI in a fresh local clone. Pass --run to start Docker services."""

import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile


def call(args, cwd, *, stdin=None):
    result = subprocess.run(args, cwd=cwd, input=stdin, capture_output=True, text=True,
                            encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed (exit={result.returncode})")
    return result.stdout.strip()


def verify(run):
    source = Path(__file__).resolve().parents[3]
    sha = call(["git", "rev-parse", "HEAD"], source)
    root = Path(tempfile.mkdtemp(prefix="pd-staging-test-"))
    call(["git", "clone", "--quiet", "--no-local", str(source), "."], root)
    call(["git", "checkout", "--detach", sha], root)
    project = "pd-rehearsal-" + secrets.token_hex(6)
    print(f"checkout={root} project={project} commit={sha}", flush=True)
    db = "synthetic_rehearsal"
    password = secrets.token_hex(24)
    values = {"APP_ENV": "staging", "LOG_LEVEL": "info", "MAIL_PROVIDER": "mock",
              "MAIL_MOCK_SEND_RESULT": "success", "REAL_MAIL_SEND_ENABLED": "false",
              "TENANT_CONTEXT_ENFORCED": "true", "POSTGRES_USER": "synthetic", "POSTGRES_DB": db,
              "POSTGRES_PASSWORD": password, "DATABASE_URL": f"postgresql://synthetic:{password}@postgres:5432/{db}",
              "APP_PORT": "127.0.0.1:3001", "POSTGRES_PORT": "127.0.0.1:5432", "FRONTEND_PORT": "127.0.0.1:3000",
              "API_BASE_URL": "http://reverse-proxy", "NEXT_PUBLIC_API_BASE_URL": "/",
              "CORS_ORIGIN": "http://reverse-proxy"}
    for key in ("JWT_SECRET", "REFRESH_TOKEN_SECRET", "AUTH_IDENTITY_HASH_SECRET", "PLATFORM_JWT_SECRET",
                "PLATFORM_REFRESH_TOKEN_SECRET", "PLATFORM_PROVISIONING_SECRET"):
        values[key] = secrets.token_hex(32)

    def write_env(settings):
        path = root / ".env"
        with open(os.open(path, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600), "w") as env:
            for key, value in settings.items():
                print(f"{key}={value}", file=env)

    args = ["--approved-synthetic-staging", "--commit", sha, "--database", db, "--rehearsal", project]

    def deploy(label, options, expected, stage, env=None):
        result = subprocess.run([sys.executable, "-B", "deploy/staging/deploy.py", *options], cwd=root,
                                env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                encoding="utf-8", errors="replace")
        output = result.stdout
        for secret in (password, values["JWT_SECRET"], "@example.local", "PoolduckStaging123!", "postgresql://"):
            if secret in output:
                raise RuntimeError("deployment output contained a sensitive value")
        print(f"case={label} exit={result.returncode}", flush=True)
        if result.returncode != expected or stage not in output:
            raise RuntimeError("unexpected deployment result: " + output)
        if expected and ("stage=caddy result=started" in output and label != "seed-interruption"
                         or label == "seed-interruption" and "stage=health result=started" in output):
            raise RuntimeError("deployment continued past the expected failure")
        if "--check" not in options:
            print(output.strip(), flush=True)

    write_env(values)
    deploy("missing-args", ["--check"], 2, "Invalid deployment arguments")
    deploy("missing-approval", [*args[1:], "--check"], 1, "stage=approval result=failed")
    deploy("wrong-commit", [*args, "--commit", "0" * 40, "--check"], 1, "commit mismatch")
    deploy("wrong-approved-db", [*args, "--database", "other_db", "--check"], 1, "database approval mismatch")
    deploy("shell-conflict", [*args, "--check"], 1, "shell target overrides",
           {**os.environ, "REAL_MAIL_SEND_ENABLED": "true"})
    for key, value in (("APP_ENV", "production"), ("MAIL_PROVIDER", "oci_email_delivery_https"),
                       ("REAL_MAIL_SEND_ENABLED", "true"), ("TENANT_CONTEXT_ENFORCED", "false"),
                       ("DATABASE_URL", values["DATABASE_URL"] + "?host=elsewhere"),
                       ("DATABASE_URL", values["DATABASE_URL"].replace("@postgres:", "@external:")),
                       ("DATABASE_URL", values["DATABASE_URL"] + "_other")):
        write_env({**values, key: value})
        deploy("reject-" + key, [*args, "--check"], 1, "stage=config result=failed")
    write_env({k: v for k, v in values.items() if k != "MAIL_PROVIDER"})
    deploy("missing-provider", [*args, "--check"], 1, "incomplete Staging .env")
    write_env(values)
    deploy("preflight", [*args, "--check"], 0, "stage=config result=passed")
    origin = "https://app.poolducktest.com"
    write_env({**values, "API_BASE_URL": origin, "CORS_ORIGIN": origin})
    deploy("staging-model-only", [*args[:-2], "--check"], 0, "stage=config result=passed")
    write_env(values)
    # An explicitly approved test commit can still contain an unsafe Compose override.
    # Keep .env correct and exercise the merged backend model (no daemon actions).
    override = root / "docker-compose.staging.yml"
    original = override.read_text(encoding="utf-8")
    faults = {
        "MAIL_PROVIDER": ('    environment:\n', '    environment:\n      MAIL_PROVIDER: oci_email_delivery_https\n'),
        "REAL_MAIL_SEND_ENABLED": ('    environment:\n', '    environment:\n      REAL_MAIL_SEND_ENABLED: "true"\n'),
        "DATABASE_URL": ('    environment:\n', '    environment:\n      DATABASE_URL: postgresql://external.invalid/other\n'),
        "postgres-volume": ('\nvolumes:\n', '\nvolumes:\n  postgres-data:\n    name: unrelated-synthetic-volume\n'),
    }
    for key, (before, after) in faults.items():
        override.write_text(original.replace(before, after, 1), encoding="utf-8")
        deploy("dirty-checkout", [*args, "--check"], 1, "checkout has unapproved changes")
        call(["git", "-c", "user.name=Rehearsal", "-c", "user.email=synthetic@example.invalid",
              "commit", "--quiet", "-am", "Isolated negative Compose fixture"], root)
        candidate = call(["git", "rev-parse", "HEAD"], root)
        deploy("effective-" + key, [*args, "--commit", candidate, "--check"], 1, "stage=config result=failed")
        call(["git", "checkout", "--detach", sha], root)
    rehearsal = root / "deploy/staging/rehearsal/compose.yml"
    rehearsal.write_text(rehearsal.read_text(encoding="utf-8").replace("  frontend:\n",
                         '  frontend:\n    environment:\n      NEXT_PUBLIC_API_BASE_URL: "//external.invalid"\n'),
                         encoding="utf-8")
    call(["git", "-c", "user.name=Rehearsal", "-c", "user.email=synthetic@example.invalid",
          "commit", "--quiet", "-am", "Isolated frontend origin fault"], root)
    candidate = call(["git", "rev-parse", "HEAD"], root)
    deploy("effective-frontend-origin", [*args, "--commit", candidate, "--check"], 1, "frontend must use same-origin")
    call(["git", "checkout", "--detach", sha], root)
    if not run:
        (root / ".env").unlink()
        return

    # Context and local endpoint were checked by the same CLI above.
    docker = ["docker", "--context", call(["docker", "context", "show"], root)]
    compose = [*docker, "compose", "-p", project, "-f", "docker-compose.yml", "-f",
               "docker-compose.staging.yml", "-f", "deploy/staging/rehearsal/compose.yml"]
    for kind in ("container", "volume", "network"):
        if call([*docker, kind, "ls", *(["-a"] if kind == "container" else []), "-q",
                 "--filter", f"label=com.docker.compose.project={project}"], root):
            raise RuntimeError("project already exists")
    release_dir = Path(tempfile.mkdtemp(prefix="pd-rehearsal-release-")) / "pair"
    print(f"preparing release={release_dir}", flush=True)
    receipt = call([sys.executable, "-B", "deploy/staging/release.py", "prepare", str(release_dir)], root)
    digest = receipt.splitlines()[-1].split()[0]
    record = json.loads((release_dir / "release.json").read_bytes())
    deploy("missing-release", args, 1, "selected release directory")
    deploy("wrong-release-digest", [*args, "--release", str(release_dir), "--lock-sha256", "0" * 64],
           1, "release digest mismatch")
    args.extend(["--release", str(release_dir), "--lock-sha256", digest])
    print(f"prepared commit={sha} release_sha256={digest} node={record['node']}", flush=True)
    deploy("first", [*args, "--seed"], 0, "stage=smoke result=passed")

    def sql(query):
        return call([*compose, "exec", "-T", "postgres", "psql", "-XAtq", "-v", "ON_ERROR_STOP=1",
                     "-U", "synthetic", "-d", db], root, stdin=query)

    sql("INSERT INTO tenants (tenant_code,name,location_limit,updated_at) "
        "VALUES ('BEEFBEEFB0','Synthetic retention witness',1,now());")

    def snapshot():
        rows = {}
        for service, image in record["images"].items():
            container = call([*compose, "ps", "-q", service], root)
            if call([*docker, "inspect", "--format", "{{.Image}}", container], root) != image:
                raise RuntimeError(f"{service} did not run the prepared image")
        for table in ("scan_events", "mail_jobs", "mail_delivery_attempts", "_prisma_migrations"):
            rows[table] = set(sql(f"SELECT md5(row_to_json(t)::text) FROM {table} t;").splitlines())
        rows["witness"] = sql("SELECT md5(row_to_json(t)::text) FROM tenants t WHERE tenant_code='BEEFBEEFB0';")
        rows["fixtures"] = []
        for table in ("tenants", "subscriptions", "users", "locations", "person_mappings", "operator_location_assignments"):
            rows["fixtures"].append(sql(f"SELECT md5((to_jsonb(t) - ARRAY['updated_at','password_hash',"
                                        f"'last_login_at'])::text) FROM {table} t ORDER BY id;"))
        rows["volumes"] = call([*docker, "volume", "inspect", "--format", "{{.Name}} {{.CreatedAt}}",
                               *[f"{project}_{v}" for v in ("postgres-data", "caddy-data", "caddy-config")]], root)
        return rows

    first = snapshot()
    migrations = len(list((root / "backend/prisma/migrations").glob("*/migration.sql")))
    if len(first["_prisma_migrations"]) != migrations or not first["witness"]:
        raise RuntimeError("initial migration or retention witness missing")
    if [len(ids.splitlines()) for ids in first["fixtures"]] != [4, 3, 6, 3, 3, 3]:
        raise RuntimeError("unexpected seed cardinality")

    def retained(previous, successful_smokes):
        now = snapshot()
        for key in ("_prisma_migrations", "witness", "fixtures", "volumes"):
            if previous[key] != now[key]:
                raise RuntimeError(f"retention mismatch: {key}")
        for table, per_smoke in (("scan_events", 2), ("mail_jobs", 2), ("mail_delivery_attempts", 1)):
            if not previous[table] <= now[table] or len(now[table]) != per_smoke * successful_smokes:
                raise RuntimeError("business history mismatch: " + table)
        print(f"retained=yes volumes=3 migrations={migrations} tenants=4 "
              f"scans={len(now['scan_events'])} jobs={len(now['mail_jobs'])} attempts={len(now['mail_delivery_attempts'])}",
              flush=True)
        return now

    retained(first, 1)
    deploy("repeat", [*args, "--seed"], 0, "stage=smoke result=passed")
    second = retained(first, 2)
    # A reversible database failure, only in this new synthetic DB. No deployment bypass/test hook.
    sql("""CREATE FUNCTION interrupt_seed() RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN RAISE EXCEPTION 'synthetic rehearsal'; END; $$;
           CREATE TRIGGER interrupt_seed BEFORE UPDATE ON subscriptions
           FOR EACH ROW EXECUTE FUNCTION interrupt_seed();""")
    deploy("seed-interruption", [*args, "--seed"], 1, "stage=seed result=failed")
    retained(second, 2)
    sql("DROP TRIGGER interrupt_seed ON subscriptions; DROP FUNCTION interrupt_seed();")
    deploy("recovery", [*args, "--seed"], 0, "stage=smoke result=passed")
    recovered = retained(second, 3)
    deploy("existing-fixture", args, 0, "stage=seed result=skipped")
    retained(recovered, 4)
    # The random project was empty at entry. Only tear it down after all assertions pass.
    call([*compose, "down", "--volumes"], root)
    (root / ".env").unlink()
    for filename in ("images.compose.yml", "images.tar", "release.json"):
        (release_dir / filename).unlink()
    release_dir.rmdir()
    release_dir.parent.rmdir()
    print("isolated project cleaned; result=passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    verify(parser.parse_args().run)
