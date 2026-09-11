"use client";

import {
  ArrowUpRightIcon,
  BellIcon,
  BookOpenTextIcon,
  CalendarCheckIcon,
  CalendarDotsIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ChartLineUpIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  ClockIcon,
  CurrencyCircleDollarIcon,
  FoldersIcon,
  GearIcon,
  HouseIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  MoonIcon,
  NotebookIcon,
  PlusIcon,
  SparkleIcon,
  StudentIcon,
  SunIcon,
  TargetIcon,
  TrendDownIcon,
  TrendUpIcon,
  UserCircleIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XIcon,
  type Icon,
  type IconWeight,
} from "@phosphor-icons/react";

export type QiwamIconName =
  | "home"
  | "people"
  | "program"
  | "calendar"
  | "target"
  | "learning"
  | "followup"
  | "reports"
  | "progress"
  | "settings"
  | "search"
  | "sun"
  | "moon"
  | "bell"
  | "menu"
  | "close"
  | "caret-left"
  | "caret-right"
  | "caret-down"
  | "plus"
  | "clock"
  | "clipboard"
  | "check"
  | "warning"
  | "money"
  | "user"
  | "trend-up"
  | "trend-down"
  | "minus"
  | "external"
  | "calendar-check"
  | "student"
  | "notebook"
  | "sparkle";

const icons: Record<QiwamIconName, Icon> = {
  home: HouseIcon,
  people: UsersThreeIcon,
  program: FoldersIcon,
  calendar: CalendarDotsIcon,
  target: TargetIcon,
  learning: BookOpenTextIcon,
  followup: BellIcon,
  reports: ChartLineUpIcon,
  progress: ArrowUpRightIcon,
  settings: GearIcon,
  search: MagnifyingGlassIcon,
  sun: SunIcon,
  moon: MoonIcon,
  bell: BellIcon,
  menu: ListIcon,
  close: XIcon,
  "caret-left": CaretLeftIcon,
  "caret-right": CaretRightIcon,
  "caret-down": CaretDownIcon,
  plus: PlusIcon,
  clock: ClockIcon,
  clipboard: ClipboardTextIcon,
  check: CheckCircleIcon,
  warning: WarningCircleIcon,
  money: CurrencyCircleDollarIcon,
  user: UserCircleIcon,
  "trend-up": TrendUpIcon,
  "trend-down": TrendDownIcon,
  minus: MinusIcon,
  external: ArrowUpRightIcon,
  "calendar-check": CalendarCheckIcon,
  student: StudentIcon,
  notebook: NotebookIcon,
  sparkle: SparkleIcon,
};

export function QiwamIcon({
  name,
  size = 20,
  weight = "regular",
  className,
}: {
  name: QiwamIconName;
  size?: number;
  weight?: IconWeight;
  className?: string;
}) {
  const Component = icons[name];
  return (
    <Component
      aria-hidden="true"
      className={className}
      size={size}
      weight={weight}
      mirrored={false}
    />
  );
}
