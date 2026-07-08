const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  testPathIgnorePatterns: ["<rootDir>/dist/"],
  transform: {
    ...tsJestTransformCfg,
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.jest.json'
    }
  }
};