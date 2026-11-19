"""Manually deploy a prepared, approved synthetic Staging checkout (Python 3.8+)."""

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[2]
FILES = ("docker-compose.yml", "docker-compose.staging.yml")
REHEARSAL = "deploy/staging/rehearsal/compose.yml"
SERVICES = {"postgres", "backend", "frontend", "reverse-proxy"}
SECRETS = ("JWT_SECRET", "REFRESH_TOKEN_SECRET", "AUTH_IDENTITY_HASH_SECRET",
           "PLATFORM_JWT_SECRET", "PLATFORM_REFRESH_TOKEN_SECRET", "PLATFORM_PROVISIONING_SECRET")
REQUIRED = ("APP_ENV", "TENANT_CONTEXT_ENFORCED", "LOG_LEVEL", "MAIL_PROVIDER",
            "MAIL_MOCK_SEND_RESULT", "REAL_MAIL_SEND_ENABLED",
            "DATABASE_URL", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", *SECRETS)
RECOVERY = {"approval": "3.1", "checkout": "3.2", "config": "3.3", "caddy": "3.4",
            "build": "3.4", "start": "3.4", "migration": "3.5", "seed": "3.5",
            "health": "3.6", "smoke": "3.6"}


class Stopped(Exception):
    """Messages are recordable. Never include a command, child output or config value."""


def require(condition, message):
    if not condition:
        raise Stopped(message)


def command(args, *, stdin=None, capture=False):
    result = subprocess.run(args, cwd=ROOT, input=stdin, text=True, encoding="utf-8",
                            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, errors="replace")
    require(result.returncode == 0, f"command exit={result.returncode}")
    return result.stdout


def checkout(commit):
    require(Path.cwd().resolve() == ROOT, "run from approved checkout root")
    require(not any(k in os.environ for k in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE")),
            "unset Git checkout overrides")
    require(re.fullmatch("[0-9a-f]{40}", commit), "approved full commit required")
    require(command(["git", "rev-parse", "HEAD"], capture=True).strip() == commit, "commit mismatch")
    require(not command(["git", "--no-optional-locks", "status", "--porcelain", "--untracked-files=all"], capture=True),
            "checkout has unapproved changes")
    # Ignored files under COPY sources / Caddy bind mounts can also affect the release.
    inputs = ["backend/src", "backend/scripts", "backend/prisma", "frontend/app", "frontend/src",
              "deploy/staging/caddy", "deploy/staging/rehearsal"]
    require(not command(["git", "ls-files", "--others", "--ignored", "--exclude-standard",
                         "--", *inputs], capture=True), "unexpected ignored deployment input")
    command(["git", "check-ignore", "-q", ".env"])


def check_db(url, db):
    target = urlsplit(url)
    require(target.scheme in {"postgres", "postgresql"} and target.hostname == "postgres"
            and target.port == 5432 and not target.query and not target.fragment
            and target.path == "/" + db["POSTGRES_DB"]
            and unquote(target.username or "") == db["POSTGRES_USER"]
            and unquote(target.password or "") == db["POSTGRES_PASSWORD"],
            "database URL disagrees with approved Compose postgres target")


@contextmanager
def deployment_lock():
    # The OS releases this lock on process exit, including interrupted deployments.
    with (ROOT / ".env.deploy-lock").open("a+b") as lock:
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise Stopped("unable to acquire deployment lock for this checkout") from None
        yield


def validate(model, approved_db, rehearsal):
    inputs = model["x-approved-inputs"]
    services = model["services"]
    require(set(services) == SERVICES, "unexpected service set")
    backend = services["backend"]["environment"]
    db = services["postgres"]["environment"]
    for key in REQUIRED:
        actual = db if key.startswith("POSTGRES_") else backend
        require(inputs[key] and (key == "DATABASE_URL" or actual.get(key) == inputs[key]),
                f"missing or conflicting {key}")
    for key, value in {"APP_ENV": "staging", "MAIL_PROVIDER": "mock", "REAL_MAIL_SEND_ENABLED": "false",
                       "TENANT_CONTEXT_ENFORCED": "true", "MAIL_MOCK_SEND_RESULT": "success"}.items():
        require(backend.get(key) == value, f"unsafe {key}")
    require(db["POSTGRES_DB"] == approved_db, "database approval mismatch")
    for key in (*SECRETS, "POSTGRES_PASSWORD"):
        require(not inputs[key].startswith(("please_change_me", "<"))
                and inputs[key] != "poolduck_local_password", f"example value in {key}")
    for url in (inputs["DATABASE_URL"], backend["DATABASE_URL"]):
        check_db(url, db)
    project = rehearsal or "poolduck-mail-staging"
    network = model["networks"]["default"]
    require(model["name"] == project and network["name"] == project + "_default"
            and not network.get("external"), "unexpected project network")
    for service in ("backend", "postgres"):
        require(set(services[service]["networks"]) == {"default"} and not services[service].get("extra_hosts"),
                "unexpected database network path")
    for name in ("postgres-data", "caddy-data", "caddy-config"):
        volume = model["volumes"][name]
        require(volume["name"] == project + "_" + name and not volume.get("external")
                and not volume.get("driver_opts"), "unexpected persistent volume")
    mounts = services["postgres"]["volumes"]
    require(len(mounts) == 1 and mounts[0]["type"] == "volume" and mounts[0]["source"] == "postgres-data"
            and mounts[0]["target"] == "/var/lib/postgresql/data", "unexpected postgres data mount")
    caddy_dir = ROOT / "deploy/staging" / ("rehearsal" if rehearsal else "caddy")
    mounts = services["reverse-proxy"]["volumes"]
    require(len(mounts) == 3 and any(m["type"] == "bind" and m["target"] == "/etc/caddy"
            and m.get("read_only") and Path(m["source"]).resolve() == caddy_dir for m in mounts),
            "unexpected Caddy configuration mount")
    for service in ("backend", "frontend"):
        build = services[service]["build"]
        require(Path(build["context"]).resolve() == ROOT / service
                and build.get("dockerfile", "Dockerfile") == "Dockerfile", "unexpected build source")
    origin = "http://reverse-proxy" if rehearsal else "https://app.poolducktest.com"
    frontend = services["frontend"]
    require(all(value == origin for value in (backend["API_BASE_URL"], backend["CORS_ORIGIN"],
                frontend["environment"]["NEXT_PUBLIC_API_BASE_URL"],
                frontend["build"]["args"]["NEXT_PUBLIC_API_BASE_URL"])), "origin mismatch")
    for service in SERVICES:
        ports = services[service].get("ports", [])
        if rehearsal:
            require(not ports, "rehearsal must have no published ports")
        elif service != "reverse-proxy":
            require(ports and all(p.get("host_ip") == "127.0.0.1" for p in ports),
                    "internal service must bind loopback")
    if rehearsal:
        require(network.get("internal") is True
                and backend["OCI_MAIL_APP_ALERTS_ENABLED"] == "false", "rehearsal network or metrics")
        for service in services.values():
            require(service["container_name"].startswith(rehearsal + "-"), "shared container name")


class Deployment:
    def __init__(self, args):
        self.args = args
        self.stage = "approval"

    def step(self, stage, action):
        self.stage = stage
        print(f"stage={stage} result=started", flush=True)
        action()
        print(f"stage={stage} result=passed", flush=True)

    def config(self):
        env = ROOT / ".env"
        require(env.is_file() and not env.is_symlink(), "prepared .env required")
        require(os.name == "nt" or env.stat().st_mode & 0o077 == 0, "restrict .env permissions")
        self.env_digest = hashlib.sha256(env.read_bytes()).digest()
        files = [*FILES, *([REHEARSAL] if self.args.rehearsal else [])]
        vars_used = set(REQUIRED)
        for file in files:
            vars_used.update(re.findall(r"\$\{([A-Z][A-Z0-9_]*)", (ROOT / file).read_text()))
        require(not any(k in vars_used or k.startswith(("COMPOSE_", "BUILDX_", "BUILDKIT_"))
                        or k == "DOCKER_HOST" for k in os.environ), "unset shell target overrides")
        keys = set()
        for line in env.read_text(encoding="utf-8-sig").splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            assignment = re.match(r"^\s*(?:export\s+)?([\w]+)\s*=", line)
            require(assignment, "expected one .env assignment per line")
            key = assignment[1]
            require(key not in keys and not key.startswith(("COMPOSE_", "DOCKER_", "BUILDX_", "BUILDKIT_")),
                    "duplicate or reserved .env setting")
            keys.add(key)
        require(set(REQUIRED) <= keys, "incomplete Staging .env")
        context = command(["docker", "context", "show"], capture=True).strip()
        endpoint = command(["docker", "context", "inspect", context, "--format",
                            "{{.Endpoints.docker.Host}}"], capture=True).strip()
        require(endpoint.startswith(("unix:///", "npipe:////./pipe/")), "local Docker engine required")
        self.docker = ["docker", "--context", context]
        project = self.args.rehearsal or "poolduck-mail-staging"
        self.compose = [*self.docker, "compose", "--project-directory", str(ROOT), "--env-file", ".env",
                        "-p", project]
        for file in files:
            self.compose.extend(["-f", file])
        # Compose itself expands the declared values and the actual model in a single pass.
        probe = {"x-approved-inputs": {k: "${" + k + ":?required}" for k in REQUIRED}}
        model = json.loads(command([*self.compose, "-f", "-", "config", "--format", "json"],
                                   stdin=json.dumps(probe), capture=True))
        validate(model, self.args.database, self.args.rehearsal)
        self.caddy_image = model["services"]["reverse-proxy"]["image"]
        print("target=synthetic-staging db=approved-compose-postgres mail=mock real_send=false")

    def run_compose(self, *args, capture=False):
        checkout(self.args.commit)
        require(hashlib.sha256((ROOT / ".env").read_bytes()).digest() == self.env_digest,
                ".env changed during deployment")
        return command([*self.compose, *args], capture=capture)

    def caddy(self):
        folder = ROOT / "deploy/staging" / ("rehearsal" if self.args.rehearsal else "caddy")
        command([*self.docker, "run", "--rm", "--network", "none", "--volume", f"{folder}:/etc/caddy:ro",
                 self.caddy_image, "caddy", "validate", "--config", "/etc/caddy/Caddyfile",
                 "--adapter", "caddyfile"])

    def health(self):
        for service in sorted(SERVICES):
            running = self.run_compose("ps", "--status", "running", "-q", service, capture=True).strip()
            require(re.fullmatch("[0-9a-f]{12,64}", running), "service missing")
            health = command([*self.docker, "inspect", "--format", "{{.State.Health.Status}}", running],
                             capture=True).strip()
            require(health == "healthy", f"{service} unhealthy")
            print(f"service={service} state=healthy")
        for path, service in (("/health", "backend"), ("/healthz", "frontend")):
            if self.args.rehearsal:
                body = self.run_compose("exec", "-T", "reverse-proxy", "wget", "-qO-",
                                        "http://127.0.0.1" + path, capture=True)
            else:
                # Loopback with the approved SNI/Host and normal certificate verification.
                body = command(["curl", "--disable", "--noproxy", "*", "--fail", "--silent",
                                "--max-time", "15", "--resolve", "app.poolducktest.com:443:127.0.0.1",
                                "https://app.poolducktest.com" + path], capture=True)
            reply = json.loads(body)
            require(reply.get("status") == "ok" and reply.get("service") == f"poolduck-mail-{service}",
                    "proxy health route mismatch")
            print(f"route={path} result=passed")

    def run(self):
        args = self.args
        require(args.approved_synthetic_staging, "synthetic Staging approval required")
        require(re.fullmatch("[A-Za-z_][A-Za-z0-9_]{0,62}", args.database)
                and args.database not in {"postgres", "template0", "template1"}, "invalid approved database")
        if args.rehearsal is not None:
            require(re.fullmatch("pd-rehearsal-[a-f0-9]{12}", args.rehearsal), "invalid rehearsal project")
        self.step("checkout", lambda: checkout(args.commit))
        print(f"commit={args.commit}", flush=True)
        self.step("config", self.config)
        if not args.check:
            with deployment_lock():
                self.deploy()

    def deploy(self):
        self.step("caddy", self.caddy)
        self.step("build", lambda: self.run_compose("build", "backend", "frontend"))
        self.step("start", lambda: self.run_compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "240"))

        def npm(*args):
            self.run_compose("exec", "-T", "backend", "npm", "run", *args)

        self.step("migration", lambda: npm("db:deploy"))
        if self.args.seed:
            self.step("seed", lambda: npm("staging:seed"))
        else:
            print("stage=seed result=skipped")
        self.step("health", self.health)
        self.step("smoke", lambda: npm("smoke:api", "--", "--staging"))


class Arguments(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "Invalid deployment arguments. See --help.\n")


def main():
    parser = Arguments(description=__doc__, allow_abbrev=False)
    parser.add_argument("--approved-synthetic-staging", action="store_true")
    parser.add_argument("--commit", required=True, help="approved full Git SHA")
    parser.add_argument("--database", required=True, help="approved Compose PostgreSQL database name")
    parser.add_argument("--seed", action="store_true", help="upsert the three synthetic tenant fixtures")
    parser.add_argument("--check", action="store_true", help="validate checkout and effective config only")
    parser.add_argument("--rehearsal", metavar="pd-rehearsal-<12 hex>", help="isolated local project")
    deploy = Deployment(parser.parse_args())
    try:
        deploy.run()
    except (Stopped, OSError, ValueError, KeyError, TypeError, AttributeError, KeyboardInterrupt) as error:
        reason = str(error) if isinstance(error, Stopped) else type(error).__name__
        print(f"stage={deploy.stage} result=failed reason={reason} "
              f"recover=docs/staging-manual.md section={RECOVERY[deploy.stage]}", file=sys.stderr)
        return 130 if isinstance(error, KeyboardInterrupt) else 1
    print("result=passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
