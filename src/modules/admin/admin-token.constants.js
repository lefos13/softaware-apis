/*
 * Shared token constants keep the stored records, middleware checks, and
 * OpenAPI descriptions aligned around one service-flag vocabulary.
 */
export const TOKEN_TYPES = {
  SUPERADMIN: 'superadmin',
  ACCESS: 'access',
};

export const ACCESS_TOKEN_SERVICE_FLAGS = {
  BOOKS_GREEK_EDITOR: 'books_greek_editor',
  PDF: 'pdf',
  IMAGE: 'image',
  TASKS: 'tasks',
};

export const ACCESS_TOKEN_SERVICE_FLAG_LIST = Object.freeze(
  Object.values(ACCESS_TOKEN_SERVICE_FLAGS),
);
