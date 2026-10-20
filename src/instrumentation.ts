export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureCore } = await import("@/lib/bootstrap");
    ensureCore();
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const { recoverInterruptedJobsOnce } = await import(
        "@/lib/jobs-recovery"
      );
      recoverInterruptedJobsOnce();
    }
  }
}
