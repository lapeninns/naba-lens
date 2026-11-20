import type { StaticImageData } from "next/image"

import barLounge from "../_samples/bar-lounge.jpg"
import beerGarden from "../_samples/beer-garden.jpg"
import chickenBhuna from "../_samples/chicken-bhuna.jpg"
import curryAngle from "../_samples/curry-angle.jpg"
import currySide from "../_samples/curry-side.jpg"
import diningRoom from "../_samples/dining-room.jpg"
import guinness from "../_samples/guinness.jpg"
import himaliLamb from "../_samples/himali-lamb.jpg"
import hotWings from "../_samples/hot-wings.jpg"
import momoAngle from "../_samples/momo-angle.jpg"
import momoClose from "../_samples/momo-close.jpg"
import momoOverhead from "../_samples/momo-overhead.jpg"

/*
 * The demo's photos (sources in ../_samples/SOURCES.md). `alt` says what is
 * in the picture, never what it has been labelled as: an unlabelled photo
 * still has to be recognisable to someone who cannot see it.
 */
export const SAMPLES = {
  "momo-overhead": {
    image: momoOverhead,
    file: "IMG_4101.jpg",
    alt: "Plate of steamed dumplings with a red dip, seen from above",
  },
  "momo-angle": {
    image: momoAngle,
    file: "IMG_4102.jpg",
    alt: "Plate of steamed dumplings with a red dip, seen from an angle",
  },
  "momo-close": {
    image: momoClose,
    file: "IMG_4103.jpg",
    alt: "Close-up of steamed dumplings on a white plate",
  },
  "curry-angle": {
    image: curryAngle,
    file: "IMG_4104.jpg",
    alt: "Bowl of orange curry with coriander, seen from an angle",
  },
  "curry-side": {
    image: currySide,
    file: "IMG_4105.jpg",
    alt: "Bowl of orange curry with coriander, seen from the side",
  },
  guinness: {
    image: guinness,
    file: "IMG_4106.jpg",
    alt: "Pint of dark stout with a cream head on a wooden table",
  },
  "bar-lounge": {
    image: barLounge,
    file: "IMG_4107.jpg",
    alt: "Lounge with armchairs, low tables and a wall television",
  },
  "hot-wings": {
    image: hotWings,
    file: "IMG_4108.jpg",
    alt: "Steaming plate of chicken wings with a lemon wedge",
  },
  "beer-garden": {
    image: beerGarden,
    file: "IMG_4067.jpg",
    alt: "Garden with picnic tables on a lawn in sunshine",
  },
  "himali-lamb": {
    image: himaliLamb,
    file: "IMG_4052.jpg",
    alt: "Shallow bowl of dark green curry on a white tablecloth",
  },
  "chicken-bhuna": {
    image: chickenBhuna,
    file: "IMG_4053.jpg",
    alt: "Bowl of thick brown curry topped with tomato and crisp onion",
  },
  "dining-room": {
    image: diningRoom,
    file: "IMG_3988.jpg",
    alt: "Dining room with laid tables and doors onto a terrace",
  },
} satisfies Record<
  string,
  { image: StaticImageData; file: string; alt: string }
>

export type SampleKey = keyof typeof SAMPLES
