class FmParser{
  constructor(setting){
    this.setting = setting;
  }
  parseCore(fm) {
    const result = {};
    for (const [key, rule] of Object.entries(this.setting.core)) {
      const raw = fm[key];
      const value = this.#normalize(raw, rule);
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
      const normalized = this.#normalize(value, rule);
      if (normalized !== null) {
        meta[key] = normalized;
      }
    }
    return meta;
  }
  #normalize(value, rule) {
    if (!rule) return null;
    const type = rule.type;
    switch (type) {
      case "string": return String(value);
      case "datetime": return this.#validateDatetime(value);
      case "array":
        if (!Array.isArray(value)) return null;
        if (!rule.items) {
          return value;
        }
        // string array
        if (rule.items.type === "string") {
          return value.map(v => String(v));
        }
        // object array
        if (rule.items.type === "object") {
          return value.map(obj => {
            const out = {};
            for (const [k, r] of Object.entries(rule.items.properties)) {
              const v = obj[k];
              const normalized = this.#normalize(v, r);
              if (normalized == null) {
                if (r.required) return null;
                continue;
              }
              out[k] = normalized;
            }
            return out;
          }).filter(v => v !== null);
        }
        return null;
      case "object":
        const obj = {};
        for (const [k, r] of Object.entries(rule.properties || {})) {
          const v = value[k];
          const normalized = this.#normalize(v, r);
          if (normalized == null) {
            if (r.required) return null;
            continue;
          }
          obj[k] = normalized;
        }
        return obj;
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

