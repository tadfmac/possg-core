class FmParser{
  constructor(setting){
    this.setting = setting;
  }
  parseCore(fm) {
    const result = {};
    for (const [key, rule] of Object.entries(this.setting.core)) {
      const raw = fm[key];
      const value = this.#normalize(raw, rule.type);
      if (value == null) {
        if (rule.required) return null; // 必須なら null return
        continue; // 読み飛ばす
      }
      result[key] = value;
    }
    return result;
  }
  parseMeta(fm) {
    const meta = {};
    for (const [key, rule] of Object.entries(this.setting.meta)) {
      const value = fm[key];
      if (value === undefined) continue;
      meta[key] = this.#normalize(value, rule.type, rule.items);
    }
    return meta;
  }
  #normalize(value, type) {
    switch (type) {
      case "string": return String(value);
      case "datetime":
      {
        const v = this.#validateDatetime(value);
        return v; // ← 正常なら string / 異常なら null
      }
      case "array":
        if (!Array.isArray(value)) return null;
        return value.map(v => String(v));
      default: return null;
    }
  }
  #validateDatetime(value) {
    if (typeof value !== "string") return null;
    const m = value.match(/^(\d{4})(\d{2})(\d{2}) (\d{2}):(\d{2})$/);
    if (!m) return null;
    const [,yearStr,monthStr,dayStr,hourStr,minuteStr] = m;
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hour = Number(hourStr);
    const minute = Number(minuteStr);

    if (month < 1 || month > 12) return null;
    if (hour < 0 || hour > 23) return null;
    if (minute < 0 || minute > 59) return null;

    const date = new Date(year, month - 1, day);
    if ((date.getFullYear() !== year) ||
        (date.getMonth() !== month - 1) ||
        (date.getDate() !== day)) {
      return null;
    }
    return value;
  }
}

export default FmParser;

