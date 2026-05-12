import { Request, Response } from "express"
import { userService } from "./users.service"
import { ChangePasswordInput, UpdateProfileInput } from "./users.schema"
import { asyncHandler } from "@/utils/asyncHandler"
import { ApiResponse } from "@/utils/apiResponse"

const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.getMe(req.user.id)
  res.status(200).json(ApiResponse.ok('Profile fetched', user))
})

const changePassword = asyncHandler(async (req: Request, res: Response) => {
  await userService.changePassword(req.user.id, req.body as ChangePasswordInput)
  res.clearCookie('refreshToken', { path: '/api/v1/auth' })
  res.status(200).json(
    ApiResponse.ok('Password changed. Please log in again on all devices.', null)
  )
})

const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateProfile(req.user.id, req.body as UpdateProfileInput)
  res.status(200).json(ApiResponse.ok('Profile updated', user))
})

export const userController = {
  getMe,
  changePassword,
  updateProfile
}