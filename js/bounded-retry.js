export function startBoundedRetry({
    initialValue,
    run,
    shouldRetry,
    maxAttempts = 3,
    retryDelayMs = (attempt) => 5000 * (2 ** (attempt - 1)),
    onError = () => {},
    schedule = setTimeout,
    cancelSchedule = clearTimeout
}) {
    let attempt = 0;
    let cancelled = false;
    let timerId;

    const execute = async (value) => {
        if (cancelled) return;
        attempt += 1;
        try {
            const result = await run(value, attempt);
            const retryValue = shouldRetry(result, value);
            if (!cancelled && retryValue !== undefined && attempt < maxAttempts) {
                timerId = schedule(() => void execute(retryValue), retryDelayMs(attempt));
            }
        } catch (error) {
            onError(error, attempt);
            if (!cancelled && attempt < maxAttempts) {
                timerId = schedule(() => void execute(value), retryDelayMs(attempt));
            }
        }
    };

    void execute(initialValue);
    return () => {
        cancelled = true;
        if (timerId !== undefined) cancelSchedule(timerId);
    };
}
