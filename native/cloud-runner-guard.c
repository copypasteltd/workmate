#define _GNU_SOURCE
#include <sys/prctl.h>
#include <unistd.h>

/* The unprivileged RPC runner and its child processes share a DynamicUser UID.
 * Customer shell code must not open the runner's /proc/PID/fd, inspect its
 * memory or forge replies into its stdout pipe. This constructor runs before
 * Node loads any customer process; the root broker independently verifies the
 * runner's protected proc ownership before admitting any operation.
 * No credentials or customer input enter this library. */
__attribute__((constructor)) static void protect_runner(void) {
    if (prctl(PR_SET_DUMPABLE, 0L, 0L, 0L, 0L) != 0)
        _exit(126);
}
