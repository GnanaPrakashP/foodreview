// @ts-nocheck
type Unit = "day" | "days" | "year";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

const SHORT_MONTHS = MONTHS.map((month) => month.slice(0, 3));

function toDate(value?: Date | number | string | DayjsLite) {
  if (value instanceof DayjsLite) return new Date(value.valueOf());
  if (value == null) return new Date();
  return new Date(value);
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

class DayjsLite {
  private readonly date: Date;

  constructor(value?: Date | number | string | DayjsLite) {
    this.date = toDate(value);
  }

  calendar(_reference?: DayjsLite, options?: { sameDay?: string }) {
    if (options?.sameDay) return options.sameDay.replace(/^\[(.*)]$/, "$1");
    return this.format("ll");
  }

  diff(other: DayjsLite, unit?: Unit) {
    const difference = this.date.getTime() - other.valueOf();
    if (unit === "day" || unit === "days") return Math.floor(difference / 86400000);
    return difference;
  }

  format(format = "LT") {
    const hours = this.date.getHours();
    const minutes = this.date.getMinutes();
    const hour12 = hours % 12 || 12;
    const amPm = hours >= 12 ? "PM" : "AM";

    if (format === "LT") return `${hour12}:${pad(minutes)} ${amPm}`;
    if (format === "ll") return `${SHORT_MONTHS[this.date.getMonth()]} ${this.date.getDate()}, ${this.date.getFullYear()}`;
    if (format === "D MMMM YYYY") {
      return `${this.date.getDate()} ${MONTHS[this.date.getMonth()]} ${this.date.getFullYear()}`;
    }

    return format
      .replace("YYYY", this.date.getFullYear().toString())
      .replace("MMMM", MONTHS[this.date.getMonth()])
      .replace("MMM", SHORT_MONTHS[this.date.getMonth()])
      .replace("MM", pad(this.date.getMonth() + 1))
      .replace("DD", pad(this.date.getDate()))
      .replace("D", this.date.getDate().toString())
      .replace("HH", pad(hours))
      .replace("mm", pad(minutes))
      .replace("A", amPm);
  }

  isSame(other: DayjsLite, unit?: Unit) {
    if (unit === "day" || unit === "days") return sameDay(this.date, other.date);
    if (unit === "year") return this.date.getFullYear() === other.date.getFullYear();
    return this.valueOf() === other.valueOf();
  }

  isValid() {
    return !Number.isNaN(this.date.getTime());
  }

  locale() {
    return this;
  }

  startOf(unit: Unit) {
    if (unit === "day" || unit === "days") {
      const next = new Date(this.date);
      next.setHours(0, 0, 0, 0);
      return new DayjsLite(next);
    }
    if (unit === "year") {
      const next = new Date(this.date);
      next.setMonth(0, 1);
      next.setHours(0, 0, 0, 0);
      return new DayjsLite(next);
    }
    return new DayjsLite(this.date);
  }

  valueOf() {
    return this.date.getTime();
  }
}

function dayjs(value?: Date | number | string | DayjsLite) {
  return new DayjsLite(value);
}

dayjs.extend = () => undefined;

export default dayjs;
