"use client";

import React, { type ComponentType } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  Clock01Icon,
  Video01Icon,
  CheckmarkCircle02Icon,
  UserIcon,
  Mail01Icon,
  Globe02Icon,
  Copy01Icon,
  ArrowRight01Icon,
  ArrowLeft01Icon,
  Settings02Icon,
  Add01Icon,
  Cancel01Icon,
  Sun03Icon,
  Moon02Icon,
  Share01Icon,
  Link01Icon,
  AlertCircleIcon,
  Delete02Icon,
  Edit02Icon,
  CheckmarkBadge01Icon,
  CalendarCheckIn01Icon,
  Search01Icon,
  SidebarLeftIcon,
  CustomerSupportIcon,
  DashboardSquare01Icon,
  Analytics01Icon,
  UserGroupIcon,
  Logout01Icon,
  PaletteIcon,
  LockIcon,
  Upload01Icon,
  File01Icon,
  Image01Icon,
  SparklesIcon,
  Compass01Icon,
} from "@hugeicons/core-free-icons";

type IconProps = {
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
};

function wrapIcon(iconDef: any): ComponentType<IconProps> {
  return function WrappedHugeIcon({ className, ...props }: IconProps) {
    return <HugeiconsIcon icon={iconDef} className={className} {...props} />;
  };
}

export const HugeCalendar = wrapIcon(Calendar03Icon);
export const HugeClock = wrapIcon(Clock01Icon);
export const HugeVideo = wrapIcon(Video01Icon);
export const HugeCheck = wrapIcon(CheckmarkCircle02Icon);
export const HugeUser = wrapIcon(UserIcon);
export const HugeMail = wrapIcon(Mail01Icon);
export const HugeGlobe = wrapIcon(Globe02Icon);
export const HugeCopy = wrapIcon(Copy01Icon);
export const HugeArrowRight = wrapIcon(ArrowRight01Icon);
export const HugeArrowLeft = wrapIcon(ArrowLeft01Icon);
export const HugeSettings = wrapIcon(Settings02Icon);
export const HugeAdd = wrapIcon(Add01Icon);
export const HugeClose = wrapIcon(Cancel01Icon);
export const HugeSun = wrapIcon(Sun03Icon);
export const HugeMoon = wrapIcon(Moon02Icon);
export const HugeShare = wrapIcon(Share01Icon);
export const HugeLink = wrapIcon(Link01Icon);
export const HugeAlert = wrapIcon(AlertCircleIcon);
export const HugeDelete = wrapIcon(Delete02Icon);
export const HugeEdit = wrapIcon(Edit02Icon);
export const HugeVerified = wrapIcon(CheckmarkBadge01Icon);
export const HugeCheckIn = wrapIcon(CalendarCheckIn01Icon);
export const HugeSearch = wrapIcon(Search01Icon);
export const HugeSidebar = wrapIcon(SidebarLeftIcon);
export const HugeSupport = wrapIcon(CustomerSupportIcon);
export const HugeDashboard = wrapIcon(DashboardSquare01Icon);
export const HugeAnalytics = wrapIcon(Analytics01Icon);
export const HugeContacts = wrapIcon(UserGroupIcon);
export const HugeLogout = wrapIcon(Logout01Icon);
export const HugePalette = wrapIcon(PaletteIcon);
export const HugeLock = wrapIcon(LockIcon);
export const HugeUpload = wrapIcon(Upload01Icon);
export const HugeFile = wrapIcon(File01Icon);
export const HugeImage = wrapIcon(Image01Icon);
export const HugeSparkles = wrapIcon(SparklesIcon);
export const HugeCompass = wrapIcon(Compass01Icon);
