export function AdvancedSendSettings({ form, setForm }) {
  return (
    <div className="advanced-box">
      <h3>Advanced settings</h3>
      <div className="form-grid">
        <label>
          Batch size
          <input
            type="number"
            min="1"
            max="1000"
            value={form.batchSize}
            onChange={(event) => setForm({ ...form, batchSize: event.target.value })}
          />
        </label>
        <label>
          Delay minutes
          <input
            type="number"
            min="0"
            max="60"
            value={form.delayMinutes}
            onChange={(event) => setForm({ ...form, delayMinutes: event.target.value })}
          />
        </label>
      </div>
      <div className="switch-row">
        <label>
          <input
            type="checkbox"
            checked={form.requireOptIn}
            onChange={(event) => setForm({ ...form, requireOptIn: event.target.checked })}
          />
          Only send to opted-in people
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.gdprMode}
            onChange={(event) => setForm({ ...form, gdprMode: event.target.checked })}
          />
          Apply EU/UK consent checks
        </label>
      </div>
    </div>
  );
}
