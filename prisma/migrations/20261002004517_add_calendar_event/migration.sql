-- CreateEnum
CREATE TYPE "CalendarCategory" AS ENUM ('CAMPING', 'PACK_NIGHT', 'ONE_DAY', 'FUNDRAISER', 'SCOUT_SUNDAY', 'GENERAL');

-- CreateEnum
CREATE TYPE "CalendarAudience" AS ENUM ('LEADERS', 'ALL_HANDS');

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "category" "CalendarCategory" NOT NULL DEFAULT 'GENERAL',
    "date" DATE,
    "endDate" DATE,
    "eitherDay" BOOLEAN NOT NULL DEFAULT false,
    "audience" "CalendarAudience",
    "noMeeting" BOOLEAN NOT NULL DEFAULT false,
    "tbd" BOOLEAN NOT NULL DEFAULT false,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "linkUrl" TEXT,
    "linkLabel" TEXT,
    "glance" BOOLEAN NOT NULL DEFAULT false,
    "glanceLabel" TEXT,
    "glanceWhen" TEXT,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_date_idx" ON "CalendarEvent"("date");

-- Seed: the 2026-2027 Calendar of Events as it stood in the pack's Google Doc
-- (50 rows), so /calendar is complete the moment this migration runs.
-- Edited from the portal after that; this never runs again.
INSERT INTO "CalendarEvent" ("id", "title", "detail", "category", "date", "endDate", "eitherDay", "audience", "noMeeting", "tbd", "important", "linkUrl", "linkLabel", "glance", "glanceLabel", "glanceWhen", "updatedAt") VALUES
  ('seedcal001', 'Boy Scout Eagle Service Project', 'Cubs encouraged to join for service hours credit', 'GENERAL', '2026-08-01', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal002', 'National Night Out', '4:00 – 7:00 PM at NYPD 61 PCT', 'GENERAL', '2026-08-04', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal003', 'Kayaking', 'Floyd Bennett Field · 10:00 AM – 1:00 PM', 'GENERAL', '2026-08-08', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal004', 'Coney Island Sand Sculpting Competition', '11:00 AM – 4:00 PM', 'GENERAL', '2026-08-15', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal005', 'Committee Meeting', '7:30 PM', 'GENERAL', '2026-08-17', NULL, false, 'LEADERS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal006', 'Leaders Meeting', '7:30 PM', 'GENERAL', '2026-08-24', NULL, false, 'LEADERS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal007', 'No Meeting', NULL, 'GENERAL', '2026-09-04', NULL, false, NULL, true, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal008', 'Scout Registration Night', 'Parents only', 'GENERAL', '2026-09-11', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal009', 'Scout Registration Night', 'Parents only · Cubmaster meeting with parents and families', 'GENERAL', '2026-09-18', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal010', 'First Scout Meeting', 'All returning scouts in full uniform', 'GENERAL', '2026-09-25', NULL, false, NULL, false, false, true, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal011', 'Scout Sunday', '10 AM Mass', 'SCOUT_SUNDAY', '2026-10-04', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal012', 'Prepare for Camping Trip', NULL, 'GENERAL', '2026-10-08', NULL, false, 'ALL_HANDS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal013', 'Camp Conron Weekend', 'Columbus Day Weekend', 'CAMPING', '2026-10-09', '2026-10-12', false, NULL, false, false, false, 'https://conron.pack376nyc.org', 'Trip details', true, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal014', 'Columbus Day', 'Return from camp', 'GENERAL', '2026-10-12', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal015', 'Setup for Pack Halloween Party', '6:00 PM', 'GENERAL', '2026-10-29', NULL, false, 'LEADERS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal016', 'Pack Halloween Party', NULL, 'PACK_NIGHT', '2026-10-30', NULL, false, NULL, false, false, false, NULL, NULL, true, 'Halloween Pack Night', NULL, CURRENT_TIMESTAMP),
  ('seedcal017', 'Scout Sunday', '10 AM Mass', 'SCOUT_SUNDAY', '2026-11-01', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal018', 'Parish Anniversary (Chartering Organization)', 'All scouts present', 'ONE_DAY', '2026-11-07', '2026-11-08', true, NULL, false, false, false, NULL, NULL, true, 'OLG Parish Anniversary Celebration', 'Early Nov', CURRENT_TIMESTAMP),
  ('seedcal019', 'Pie Night & Bring-a-Friend Night', NULL, 'ONE_DAY', '2026-11-20', NULL, false, NULL, false, false, false, NULL, NULL, true, 'Bring a Pie & Bring a Friend Night', NULL, CURRENT_TIMESTAMP),
  ('seedcal020', 'OLG Christmas Fair — Pack Fundraiser', NULL, 'FUNDRAISER', '2026-11-22', NULL, false, 'ALL_HANDS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal021', 'Black Friday — No Meeting', NULL, 'GENERAL', '2026-11-27', NULL, false, NULL, true, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal022', 'Setup for Pack Christmas Party', '6:00 PM', 'GENERAL', '2026-12-17', NULL, false, 'ALL_HANDS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal023', 'Christmas Pack Night', NULL, 'PACK_NIGHT', '2026-12-18', NULL, false, NULL, false, false, false, NULL, NULL, true, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal024', 'Scout Sunday', '10 AM Mass', 'SCOUT_SUNDAY', '2026-12-20', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal025', 'Christmas Day — No Meeting', NULL, 'GENERAL', '2026-12-25', NULL, false, NULL, true, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal026', 'New Year''s Day — No Meeting', NULL, 'GENERAL', '2027-01-01', NULL, false, NULL, true, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal027', 'Scout Sunday', '10 AM Mass', 'SCOUT_SUNDAY', '2027-01-10', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal028', 'Klondike Derby', 'Coney Island', 'ONE_DAY', '2027-01-31', NULL, false, NULL, false, false, false, NULL, NULL, true, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal029', 'Pinewood Derby Setup', '6:00 PM', 'GENERAL', '2027-03-04', NULL, false, 'ALL_HANDS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal030', 'Pack 376 Pinewood Derby + Overnight Lockup', NULL, 'PACK_NIGHT', '2027-03-05', '2027-03-06', false, NULL, false, false, false, NULL, NULL, true, 'Pinewood Derby & Lockup Overnighter', NULL, CURRENT_TIMESTAMP),
  ('seedcal031', 'Kings Plaza Pinewood Derby Competition', 'Pack participation TBD', 'ONE_DAY', '2027-03-06', NULL, false, NULL, false, true, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal032', 'Scout Sunday · OLG Easter Fair', NULL, 'SCOUT_SUNDAY', '2027-03-14', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal033', 'Easter Fair Bake Sale Fundraiser', NULL, 'FUNDRAISER', '2027-03-14', NULL, false, 'ALL_HANDS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal034', 'Pull Camping Gear', '6:00 PM', 'GENERAL', '2027-03-18', NULL, false, 'ALL_HANDS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal035', 'Camp Pouch Weekend', NULL, 'CAMPING', '2027-03-19', '2027-03-21', false, NULL, false, false, false, NULL, NULL, true, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal036', 'Good Friday — No Meeting', NULL, 'GENERAL', '2027-03-26', NULL, false, NULL, true, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal037', 'Easter Sunday Bake Sale for Easter Mass', NULL, 'FUNDRAISER', '2027-03-28', NULL, false, 'ALL_HANDS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal038', 'Scout Sunday', '10 AM Mass', 'SCOUT_SUNDAY', '2027-04-04', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal039', 'Pull Camping Gear', '6:00 PM', 'GENERAL', '2027-05-06', NULL, false, 'ALL_HANDS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal040', 'Camp Alpine Campout + Cub Day Activities', NULL, 'CAMPING', '2027-05-07', '2027-05-09', false, NULL, false, false, false, NULL, NULL, true, 'Camp Alpine + Cub Day Weekend', NULL, CURRENT_TIMESTAMP),
  ('seedcal041', 'Cub Day @ Alpine Activities', NULL, 'ONE_DAY', '2027-05-08', NULL, false, NULL, false, false, false, NULL, NULL, true, 'Cub Day @ Alpine', NULL, CURRENT_TIMESTAMP),
  ('seedcal042', 'Scout Sunday', '10 AM Mass', 'SCOUT_SUNDAY', '2027-05-23', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal043', 'Pull Camping Gear', '6:00 PM', 'GENERAL', '2027-05-27', NULL, false, 'ALL_HANDS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal044', 'Memorial Day Camping Trip with Troop 376', NULL, 'CAMPING', '2027-05-28', '2027-05-31', false, NULL, false, false, false, NULL, NULL, true, 'Memorial Day Camping w/ Troop 376', NULL, CURRENT_TIMESTAMP),
  ('seedcal045', 'Carnival Setup', '5:00 PM', 'GENERAL', '2027-06-03', NULL, false, 'ALL_HANDS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal046', 'Carnival Night', NULL, 'PACK_NIGHT', '2027-06-04', NULL, false, 'ALL_HANDS', false, false, false, NULL, NULL, true, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal047', 'Scout Sunday', '10 AM Mass', 'SCOUT_SUNDAY', '2027-06-06', NULL, false, NULL, false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal048', 'Graduation Setup', '6:00 PM', 'GENERAL', '2027-06-17', NULL, false, 'ALL_HANDS', false, false, false, NULL, NULL, false, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal049', 'Graduation Night', 'Crossing-Over Ceremony', 'PACK_NIGHT', '2027-06-18', NULL, false, NULL, false, false, false, NULL, NULL, true, NULL, NULL, CURRENT_TIMESTAMP),
  ('seedcal050', 'Brooklyn Cyclones Outing', NULL, 'ONE_DAY', NULL, NULL, false, NULL, false, true, false, NULL, NULL, true, NULL, 'TBD', CURRENT_TIMESTAMP);
