import { z } from "zod";

export const beatSchema = z.object({
  type: z.enum(["action", "dialogue"]),
  character: z.string().optional().default(""),
  text: z.string(),
});

export const sceneSchema = z.object({
  index: z.string(),
  slug: z.string().default(""),
  location: z.string().default(""),
  timeOfDay: z.string().default(""),
  interiorExterior: z.enum(["内", "外", ""]).default(""),
  summary: z.string().default(""),
  characters: z.array(z.string()).default([]),
  beats: z.array(beatSchema).default([]),
});

export const scriptSchema = z.object({
  title: z.string().default(""),
  scenes: z.array(sceneSchema),
});

export type Beat = z.infer<typeof beatSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Script = z.infer<typeof scriptSchema>;
