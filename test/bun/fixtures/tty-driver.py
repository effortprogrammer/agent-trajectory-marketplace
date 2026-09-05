import errno
import json
import os
import pty
import select
import signal
import subprocess
import sys
import time

reply = sys.argv[1]
command = sys.argv[2:]
master, slave = pty.openpty()
process = subprocess.Popen(
    command,
    stdin=slave,
    stdout=slave,
    stderr=slave,
    close_fds=True,
    start_new_session=True,
    env=os.environ.copy(),
)
os.close(slave)
prompt = b"Type yes to continue:"
output = bytearray()
prompt_seen = False
deadline = time.monotonic() + 10
replies = {
    "yes": b"yes\n",
    "no": b"no\n",
    "blank": b"\n",
    "eof": b"\x04",
}

try:
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("TTY prompt or process completion timed out")
        readable, _, _ = select.select([master], [], [], remaining)
        if not readable:
            raise TimeoutError("TTY prompt or process completion timed out")
        try:
            chunk = os.read(master, 4096)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        if not chunk:
            break
        output.extend(chunk)
        if not prompt_seen and prompt in output:
            prompt_seen = True
            if reply == "abort":
                os.killpg(process.pid, signal.SIGINT)
            else:
                os.write(master, replies[reply])
    exit_code = process.wait(timeout=max(0, deadline - time.monotonic()))
finally:
    os.close(master)
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()

print(json.dumps({
    "exitCode": exit_code,
    "output": output.decode("utf-8", "replace"),
    "promptSeen": prompt_seen,
}))
