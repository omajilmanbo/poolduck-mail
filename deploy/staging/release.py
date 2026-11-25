"""Build a Staging application pair once, or verify and load its saved images."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
SERVICES = ("backend", "frontend")


def output(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_image(image, service, revision, node, platform):
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
        raise ValueError(f"{service}: invalid image ID")
    info = json.loads(output("docker", "image", "inspect", image))[0]
    labels = info["Config"]["Labels"]
    if (info["Id"] != image or labels.get("org.opencontainers.image.revision") != revision
            or labels.get("com.poolduck.service") != service
            or f"{info['Os']}/{info['Architecture']}" != platform):
        raise ValueError(f"{service}: image identity or platform mismatch")
    actual = output("docker", "run", "--rm", "--pull=never", "--network=none",
                    "--read-only", "--entrypoint=node", image, "--version")
    if actual != "v" + node:
        raise ValueError(f"{service}: expected Node {node}, got {actual}")
    if service == "backend":
        # Prisma migrations need the OpenSSL shared libraries in the unpacked image.
        output("docker", "run", "--rm", "--pull=never", "--network=none",
               "--read-only", "--entrypoint=openssl", image, "version")


def prepare(folder, revision, node, platform):
    folder.mkdir(parents=True, exist_ok=False)
    images = {}
    with tempfile.TemporaryDirectory() as scratch:
        for service in SERVICES:
            context = Path(scratch) / "context.tar"
            iid = Path(scratch) / f"{service}.id"
            subprocess.run(["git", "-c", "core.autocrlf=false", "archive", "--format=tar",
                            "-o", context, f"{revision}:{service}"], cwd=ROOT, check=True)
            args = ["docker", "build", "--platform", platform, "--iidfile", iid,
                    "--label", f"org.opencontainers.image.revision={revision}",
                    "--label", f"com.poolduck.service={service}"]
            if service == "frontend":
                args.extend(["--build-arg", "NEXT_PUBLIC_API_BASE_URL=/"])
            with context.open("rb") as source:
                subprocess.run([*args, "-"], stdin=source, cwd=ROOT, check=True)
            # Docker's active image store supplies the ID accepted by inspect/save/run.
            image = output("docker", "image", "inspect", "--format", "{{.Id}}", iid.read_text().strip())
            check_image(image, service, revision, node, platform)
            images[service] = image
    archive = folder / "images.tar"
    subprocess.run(["docker", "image", "save", "-o", archive, *images.values()], check=True)
    lock = folder / "release.json"
    lock.write_text(json.dumps(dict(revision=revision, node=node, platform=platform, images=images,
                                    archive_sha256=sha256(archive)), indent=2) + "\n", encoding="utf-8")
    print(f"{sha256(lock)}  release.json")


def verify(folder, expected, revision, node, platform):
    lock = folder / "release.json"
    if sha256(lock) != expected:
        raise ValueError("release.json differs from the selected release record")
    record = json.loads(lock.read_bytes())
    if (record["revision"], record["node"], record["platform"]) != (revision, node, platform):
        raise ValueError("checkout, Node pin or Docker server platform differs from the release")
    archive = folder / "images.tar"
    if sha256(archive) != record["archive_sha256"]:
        raise ValueError("images.tar checksum mismatch")
    subprocess.run(["docker", "image", "load", "-i", archive], check=True)
    lines = ["services:"]
    for service in SERVICES:
        image = record["images"][service]
        check_image(image, service, revision, node, platform)
        lines.extend([f"  {service}:", "    build: !reset null",
                      f"    image: {image}", "    pull_policy: never"])
    # Only publish the Compose overlay after both images have been verified.
    with tempfile.NamedTemporaryFile(mode="w", dir=folder, delete=False, encoding="utf-8") as tmp:
        tmp.write("\n".join(lines) + "\n")
    Path(tmp.name).replace(folder / "images.compose.yml")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("prepare").add_argument("directory", type=Path)
    verify_args = commands.add_parser("verify")
    verify_args.add_argument("directory", type=Path)
    verify_args.add_argument("lock_sha256", help="digest from the selected release record")
    args = parser.parse_args()
    revision = output("git", "rev-parse", "HEAD")
    node = output("git", "show", f"{revision}:.nvmrc")
    platform = output("docker", "version", "--format", "{{.Server.Os}}/{{.Server.Arch}}")
    if args.action == "prepare":
        prepare(args.directory.resolve(), revision, node, platform)
    else:
        subprocess.run(["git", "diff", "--quiet", "HEAD", "--", "docker-compose.yml",
                        "docker-compose.staging.yml", "deploy/staging"], cwd=ROOT, check=True)
        verify(args.directory.resolve(), args.lock_sha256, revision, node, platform)


if __name__ == "__main__":
    main()
