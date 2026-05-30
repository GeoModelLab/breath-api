using System.Collections.Concurrent;

namespace BreathApi.Utils
{
    public enum SimulationState { Idle, Running, Completed, Failed }

    public static class LogStreamer
    {
        private static readonly ConcurrentQueue<string> _queue = new();
        private static readonly ConcurrentBag<IObserver<string>> _observers = new();

        // ── Simulation status tracking ────────────────────────────────────
        public static SimulationState Status { get; private set; } = SimulationState.Idle;
        public static DateTime? LastRunStarted  { get; private set; }
        public static DateTime? LastRunFinished { get; private set; }
        public static string?   LastPixelId     { get; private set; }

        public static void SetRunning(string pixelId)
        {
            Status         = SimulationState.Running;
            LastRunStarted = DateTime.UtcNow;
            LastRunFinished = null;
            LastPixelId    = pixelId;
        }

        public static void SetCompleted()
        {
            Status          = SimulationState.Completed;
            LastRunFinished = DateTime.UtcNow;
        }

        public static void SetFailed()
        {
            Status          = SimulationState.Failed;
            LastRunFinished = DateTime.UtcNow;
        }
        // ─────────────────────────────────────────────────────────────────

        public static void Log(string message)
        {
            _queue.Enqueue(message);
            foreach (var obs in _observers)
            {
                try { obs.OnNext(message); } catch { }
            }
            Console.WriteLine(message);
        }

        public static void Clear()
        {
            while (_queue.TryDequeue(out _)) { }
        }

        public static async IAsyncEnumerable<string> StreamAsync(CancellationToken token)
        {
            var channel = System.Threading.Channels.Channel.CreateUnbounded<string>();
            var observer = new Observer(channel);
            _observers.Add(observer);

            try
            {
                while (!token.IsCancellationRequested)
                {
                    if (await channel.Reader.WaitToReadAsync(token))
                    {
                        while (channel.Reader.TryRead(out var msg))
                        {
                            yield return msg;
                        }
                    }
                    await Task.Delay(500, token);
                }
            }
            finally
            {
                // ✅ Fix: convert to IObserver<string> when removing
                if (_observers.TryTake(out IObserver<string>? obs))
                {
                    // just discard
                }
            }
        }


        private sealed class Observer : IObserver<string>
        {
            private readonly System.Threading.Channels.Channel<string> _channel;
            public Observer(System.Threading.Channels.Channel<string> channel) => _channel = channel;
            public void OnCompleted() { }
            public void OnError(Exception error) { }
            public void OnNext(string value) => _channel.Writer.TryWrite(value);
        }
    }
}
