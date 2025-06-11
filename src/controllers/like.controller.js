import mongoose, {isValidObjectId} from "mongoose"
import {Like} from "../models/like.model.js"
import {ApiError} from "../utils/ApiError.js"
import {ApiResponse} from "../utils/ApiResponse.js"
import {asyncHandler} from "../utils/asyncHandler.js"
import { Video } from "../models/video.model.js"
import { Comment } from "../models/comment.model.js"

const toggleVideoLike = asyncHandler(async (req, res) => {
    const { videoId } = req.params; // Get the video ID from URL parameters
    const userId = req.user?._id;   // Get the authenticated user's ID from req.user (assuming your auth middleware sets this)

    // --- Input Validation ---
    // Check if videoId is provided
    if (!videoId) {
        throw new ApiError(400, "Video ID is required");
    }

    // Validate if videoId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
        throw new ApiError(400, "Invalid Video ID provided");
    }

    // --- Video Existence Check ---
    // Before processing the like, ensure the video actually exists
    const video = await Video.findById(videoId);
    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    // --- Authorization (Optional but Recommended) ---
    // Though liking is usually public, if you had specific rules (e.g., only verified users can like),
    // you would add checks here. For a simple like, verifying user existence is enough.
    // Ensure `userId` is available (user is authenticated)
    if (!userId) {
        throw new ApiError(401, "User not authenticated to like videos");
    }

    // --- Toggle Like Logic ---
    // Check if the user has already liked this video
    const existingLike = await Like.findOne({
        video: videoId, // Match by the video being liked
        likedBy: userId,  // Match by the user who is liking
    });

    let message;
    let isLiked; // Variable to store the new like status

    if (existingLike) {
        // If a like document exists, the user is unliking the video
        await Like.deleteOne({ _id: existingLike._id });
        message = "Video unliked successfully";
        isLiked = false;
    } else {
        // If no like document exists, the user is liking the video
        await Like.create({
            video: videoId,
            likedBy: userId,
        });
        message = "Video liked successfully";
        isLiked = true;
    }

    // --- Send Response ---
    // Return a 200 OK response with the new like status and a message
    return res
        .status(200)
        .json(new ApiResponse(
            200,
            { isLiked }, // Return the new status of the like
            message
        ));
})

const toggleCommentLike = asyncHandler(async (req, res) => {
    const {commentId} = req.params// Get the video ID from URL parameters
    const userId = req.user?._id;   // Get the authenticated user's ID from req.user (assuming your auth middleware sets this)

    // --- Input Validation ---
    // Check if videoId is provided
    if (!commentId) {
        throw new ApiError(400, "Comment ID is required");
    }

    // Validate if videoId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(commentId)) {
        throw new ApiError(400, "Invalid comment ID provided");
    }
    const comment = await Comment.findById(commentId);
    if (!comment) {
        throw new ApiError(404, "Video not found");
    }
    if (!userId) {
        throw new ApiError(401, "User not authenticated to like videos");
    }
    const existingLike = await Like.findOne({
        comment: commentId, // Match by the video being liked
        likedBy: userId,  // Match by the user who is liking
    });

    let message;
    let isLiked; // Variable to store the new like status

    if (existingLike) {
        // If a like document exists, the user is unliking the video
        await Like.deleteOne({ _id: existingLike._id });
        message = "comment unliked successfully";
        isLiked = false;
    } else {
        // If no like document exists, the user is liking the video
        await Like.create({
            comment: commentId,
            video : comment.video,
            likedBy: userId,
        });
        message = "comment liked successfully";
        isLiked = true;
    }

    // --- Send Response ---
    // Return a 200 OK response with the new like status and a message
    return res
        .status(200)
        .json(new ApiResponse(
            200,
            { isLiked }, // Return the new status of the like
            message
        ));

})

const toggleTweetLike = asyncHandler(async (req, res) => {
    const {tweetId} = req.params
    //TODO: toggle like on tweet
}
)

const getLikedVideos = asyncHandler(async (req, res) => {
       const userId = req.user?._id; // Get the ID of the authenticated user

    // 1. Validate userId
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        throw new ApiError(401, "User not authenticated or invalid user ID");
    }

    // 2. Aggregation Pipeline to get liked videos
    const likedVideos = await Like.aggregate([
        {
            // Stage 1: Match likes by the current user
            $match: {
                likedBy: new mongoose.Types.ObjectId(userId),
                video: { $exists: true, $ne: null } // Ensure it's a like on a video and video field is not null
            }
        },
        {
            // Stage 2: Look up the actual video document from the 'videos' collection
            $lookup: {
                from: "videos", // The collection name (Mongoose pluralizes model names by default)
                localField: "video", // Field from the 'likes' collection
                foreignField: "_id", // Field from the 'videos' collection
                as: "videoDetails" // Alias for the joined video document
            }
        },
        {
            // Stage 3: Deconstruct the 'videoDetails' array
            // This is needed because $lookup returns an array.
            // If a video is not found (e.g., deleted), this stage will filter out that like document.
            $unwind: "$videoDetails"
        },
        {
            // Stage 4: Project (select) only the necessary fields from the videoDetails
            // You can customize which fields you want to return
            $project: {
                _id: "$videoDetails._id",
                videoFile: "$videoDetails.videoFile", // The video link/URL
                thumbnail: "$videoDetails.thumbnail",
                title: "$videoDetails.title",
                description: "$videoDetails.description",
                duration: "$videoDetails.duration",
                views: "$videoDetails.views",
                isPublished: "$videoDetails.isPublished",
                owner: "$videoDetails.owner",
                createdAt: "$videoDetails.createdAt"
            }
        },
        {
            // Stage 5 (Optional): Look up the owner's details if needed
            $lookup: {
                from: "users", // The collection name for users
                localField: "owner",
                foreignField: "_id",
                as: "ownerDetails"
            }
        },
        {
            // Stage 6 (Optional): Deconstruct the ownerDetails array
            $unwind: "$ownerDetails"
        },
        {
            // Stage 7 (Optional): Project desired owner fields
            $project: {
                _id: 1, // Keep video _id
                videoFile: 1,
                thumbnail: 1,
                title: 1,
                description: 1,
                duration: 1,
                views: 1,
                isPublished: 1,
                createdAt: 1,
                owner: {
                    _id: "$ownerDetails._id",
                    username: "$ownerDetails.username",
                    fullName: "$ownerDetails.fullName",
                    avatar: "$ownerDetails.avatar"
                }
            }
        }
    ]);

    // 3. Handle empty results
    if (likedVideos.length === 0) {
        return res
            .status(200)
            .json(
                new ApiResponse(200, [], "User hasn't liked any videos")
            );
    }

    // 4. Return the list of liked videos
    return res
        .status(200)
        .json(new ApiResponse(
            200,
            likedVideos, // likedVideos now contains the projected video details
            "Liked videos fetched successfully"
        ));
});


export {
    toggleCommentLike,
    toggleTweetLike,
    toggleVideoLike,
    getLikedVideos
}