"""The sweep's own schedule: a launchd agent that runs it at set hours (macOS)."""

from __future__ import annotations

import os
import plistlib
import subprocess
import sys
from pathlib import Path

from .config import Settings
from .plan import PLAN_END_HOUR, PLAN_START_HOUR
from .selfcmd import self_command
from .wrapup import WRAPUP_HOUR

LABEL = "com.todohub.sweep"
WEEKDAYS = (1, 2, 3, 4, 5)   # launchd: 0 and 7 are Sunday


class ScheduleError(RuntimeError):
    pass


def plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def supported() -> bool:
    return sys.platform == "darwin"


def installed() -> bool:
    return plist_path().exists()


def schedule_plist(settings: Settings) -> dict:
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin")}
    if os.environ.get("TODOHUB_HOME"):
        env["TODOHUB_HOME"] = os.environ["TODOHUB_HOME"]
    hours = settings.schedule_hours()
    if settings.schedule_days == "every day":
        times = [{"Hour": h, "Minute": 0} for h in hours]
    else:
        times = [{"Weekday": d, "Hour": h, "Minute": 0} for d in WEEKDAYS for h in hours]
    return {
        "Label": LABEL,
        "ProgramArguments": [*self_command("sweep"), "--trigger", "schedule"],
        "StartCalendarInterval": times,
        "EnvironmentVariables": env,
        "StandardOutPath": str(settings.log_dir / "launchd.log"),
        "StandardErrorPath": str(settings.log_dir / "launchd.log"),
        "ProcessType": "Background",
    }


def install(settings: Settings) -> None:
    """Write the agent and (re)load it, so the new hours apply right away."""
    if not supported():
        raise ScheduleError("The schedule uses macOS launchd; it can't be installed on this system.")
    path = plist_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    plist = schedule_plist(settings)
    # Changing the hours from the app keeps what runs: a schedule set up from the checkout
    # (`todohub install-schedule`) keeps running the checkout, not the app's bundled copy.
    plist.update(kept_program(path))
    with open(path, "wb") as fh:
        plistlib.dump(plist, fh)
    domain = f"gui/{os.getuid()}"
    subprocess.call(["launchctl", "bootout", domain, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    proc = subprocess.run(["launchctl", "bootstrap", domain, str(path)], capture_output=True, text=True)
    if proc.returncode != 0:
        raise ScheduleError(f"launchctl couldn't load the schedule: {proc.stderr.strip()[:200] or proc.returncode}")


def kept_program(path: Path) -> dict:
    """ProgramArguments and EnvironmentVariables of an existing agent, or {} if there's none."""
    try:
        with open(path, "rb") as fh:
            old = plistlib.load(fh)
    except (OSError, plistlib.InvalidFileException, ValueError):
        return {}
    return {k: old[k] for k in ("ProgramArguments", "EnvironmentVariables") if old.get(k)}


def uninstall() -> None:
    path = plist_path()
    subprocess.call(["launchctl", "bootout", f"gui/{os.getuid()}", str(path)], stderr=subprocess.DEVNULL)
    path.unlink(missing_ok=True)


def describe(settings: Settings, is_installed: bool | None = None) -> dict:
    """The schedule as the Settings page shows it, with the runs that bring the plan and wrap-up."""
    hours = settings.schedule_hours()
    return {
        "every": settings.schedule_every, "start": settings.schedule_start, "end": settings.schedule_end,
        "days": settings.schedule_days, "hours": hours,
        "plan_hour": next((h for h in hours if PLAN_START_HOUR <= h < PLAN_END_HOUR), None),
        "wrapup_hour": next((h for h in hours if h >= WRAPUP_HOUR), None),
        "installed": installed() if is_installed is None else is_installed,
        "supported": supported(),
    }


def summary(settings: Settings) -> str:
    hours = ", ".join(f"{h}:00" for h in settings.schedule_hours())
    return f"{'every day' if settings.schedule_days == 'every day' else 'weekdays'} at {hours}"
