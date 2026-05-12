import { Router } from "express";
import { userController } from "./users.controller";
import { validate } from "@/middleware/validate.middleware";
import { changePasswordSchema, updateProfileSchema } from "./users.schema";
import { authenticate } from "@/middleware/auth.middleware";

export const usersRouter = Router()


// GET /api/v1/users/me

usersRouter.get(
    '/me',
    authenticate,
    userController.getMe
)

// PATCH /api/v1/users/change-password

usersRouter.patch(
    '/change-password',
    authenticate,
    validate(changePasswordSchema),
    userController.changePassword
)

// PATCH /api/v1/users/profile

usersRouter.patch(
    '/profile',
    authenticate,
    validate(updateProfileSchema),
    userController.updateProfile
)
