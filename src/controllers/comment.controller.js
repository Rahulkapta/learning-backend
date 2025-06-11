import mongoose from "mongoose";
import { Comment } from "../models/comment.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Video } from "../models/video.model.js";
import { Like } from "../models/like.model.js";

const getVideoComments = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  // Parse page and limit from query parameters, default to 1 and 10
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;

  // 1. Input Validation
  if (!videoId) {
    throw new ApiError(400, "Video ID is required");
  }
  if (!mongoose.Types.ObjectId.isValid(videoId)) {
    throw new ApiError(400, "Invalid Video ID provided");
  }

  // 2. Verify Video Existence
  // It's good practice to ensure the video exists before trying to fetch its comments.
  const video = await Video.findById(videoId);
  if (!video) {
    throw new ApiError(404, "Video not found");
  }

  // 3. Aggregate Comments with Pagination
  // We'll use an aggregation pipeline for robust filtering, sorting, and pagination.
  const commentsAggregate = Comment.aggregate([
    {
      // Stage 1: Match comments belonging to the specific video
      $match: {
        video: new mongoose.Types.ObjectId(videoId),
      },
    },
    {
      // Stage 2: Look up the owner details for each comment
      $lookup: {
        from: "users", // The collection name for users
        localField: "owner", // Field from the 'comments' collection
        foreignField: "_id", // Field from the 'users' collection
        as: "ownerDetails", // Alias for the joined user document
      },
    },
    {
      // Stage 3: Deconstruct the 'ownerDetails' array
      // Since a comment has only one owner, this converts the ownerDetails array into an object.
      // If the owner is not found, this comment will be filtered out.
      $unwind: "$ownerDetails",
    },
    {
      // Stage 4: Project (select) the desired fields for the response
      // We want comment details and relevant owner details.
      $project: {
        _id: 1,
        content: 1,
        createdAt: 1,
        updatedAt: 1,
        owner: {
          _id: "$ownerDetails._id",
          username: "$ownerDetails.username",
          fullName: "$ownerDetails.fullName",
          avatar: "$ownerDetails.avatar",
        },
      },
    },
    {
      // Stage 5: Sort comments (e.g., by creation date, newest first)
      $sort: {
        createdAt: -1, // Sort by createdAt field in descending order (newest first)
      },
    },
    // Pagination stages will be applied by Mongoose's .aggregatePaginate()
  ]);

  // 4. Apply Pagination using mongoose-aggregate-paginate-v2
  // Assuming you have 'mongoose-aggregate-paginate-v2' installed and applied to your Comment model.
  // If not, you'd manually add $skip and $limit stages.
  const options = {
    page: page,
    limit: limit,
    customLabels: {
      docs: "comments", // Custom label for the comments array
      totalDocs: "totalComments",
      totalPages: "totalPages",
      nextPage: "nextPage",
      prevPage: "prevPage",
      pagingCounter: "slNo",
      meta: "pagination", // Wrap pagination details under a 'pagination' key
    },
  };

  const result = await Comment.aggregatePaginate(commentsAggregate, options);

  // 5. Return Response
  return res.status(200).json(
    new ApiResponse(
      200,
      result, // The paginated result object contains comments array and pagination metadata
      "Video comments fetched successfully"
    )
  );
});

const addComment = asyncHandler(async (req, res) => {
  const { content } = req.body;
  const { videoId } = req.params;
  const userId = req.user?._id;

  // 2. Input Validation (Content & Video ID)
  if (!content || content.trim() === "") {
    throw new ApiError(400, "Comment content is required");
  }

  if (!videoId) {
    throw new ApiError(400, "Video ID is required");
  }
  if (!mongoose.Types.ObjectId.isValid(videoId)) {
    throw new ApiError(400, "Invalid Video ID");
  }

  if (!userId) {
    throw new ApiError(401, "User not authenticated to like videos");
  }

  const video = await Video.findById(videoId);
  if (!video) {
    throw new ApiError(404, "Video not found");
  }

  const createdComment = await Comment.create({
    content: content.trim(),
    video: videoId,
    owner: userId,
  });
  if (!createdComment) {
    throw new ApiError(500, "Something went wrong while adding the comment");
  }
  const populatedComment = await Comment.findById(createdComment._id)
    .populate({
      path: "owner",
      select: "username avatar fullName", // Select relevant user fields
    })
    .populate({
      path: "video",
      select: "title thumbnail", // Select relevant video fields
    });
  return res
    .status(201) // Use 201 Created for successful resource creation
    .json(
      new ApiResponse(
        201, // Use 201 status for consistency
        populatedComment, // Return the complete created comment object
        "Comment added successfully"
      )
    );
});

const updateComment = asyncHandler(async (req, res) => {
  const { content } = req.body;
  const { commentId } = req.params;
  const userId = req.user?._id;

  // 2. Input Validation (Content & Video ID)
  if (!content || content.trim() === "") {
    throw new ApiError(400, "Comment content is required");
  }

  if (!commentId) {
    throw new ApiError(400, "Comment ID is required in parameters");
  }
  if (!mongoose.Types.ObjectId.isValid(commentId)) {
    throw new ApiError(400, "Invalid Comment ID provided");
  }
  if (!userId) {
    throw new ApiError(401, "User not authenticated to update comments");
  }
  // 4. Find the existing comment and verify ownership
  const commentToUpdate = await Comment.findById(commentId);
  // console.log(commentToUpdate)

  if (!commentToUpdate) {
    throw new ApiError(404, "Comment not found");
  }

  // Authorization check: Ensure the authenticated user is the owner of the comment
  if (commentToUpdate.owner.toString() !== userId.toString()) {
    throw new ApiError(403, "You are not authorized to update this comment");
  }

  const updatedComment = await Comment.findByIdAndUpdate(
    commentId, // Use commentId here
    {
      $set: {
        content, // Use the cleaned content
      },
    },
    { new: true } // Return the updated document
  );
  if (!updatedComment) {
    throw new ApiError(500, "Something went wrong while updating the comment");
  }

  const populatedUpdatedComment = await Comment.findById(updatedComment._id)
    .populate({
      path: "owner",
      select: "username avatar fullName", // Select relevant user fields
    })
    .populate({
      path: "video",
      select: "title thumbnail", // Select relevant video fields
    });
  return res
    .status(200) // Use 201 Created for successful resource creation
    .json(
      new ApiResponse(
        200, // Use 201 status for consistency
        populatedUpdatedComment, // Return the complete created comment object
        "Comment updated successfully"
      )
    );
});

const deleteComment = asyncHandler(async (req, res) => {
  // 1. Get IDs from request
  const { commentId } = req.params; // Expecting commentId from URL parameters
  const userId = req.user?._id; // Get the authenticated user's ID

  // 2. Input Validation
  if (!commentId) {
    throw new ApiError(400, "Comment ID is required in parameters");
  }
  if (!mongoose.Types.ObjectId.isValid(commentId)) {
    throw new ApiError(400, "Invalid Comment ID provided");
  }

  // 3. User Authentication Check
  if (!userId) {
    throw new ApiError(401, "User not authenticated to delete comments");
  }

  // 4. Find the existing comment and verify ownership
  const commentToDelete = await Comment.findById(commentId);

  if (!commentToDelete) {
    throw new ApiError(404, "Comment not found");
  }

  // Authorization check: Ensure the authenticated user is the owner of the comment
  if (commentToDelete.owner.toString() !== userId.toString()) {
    throw new ApiError(403, "You are not authorized to delete this comment");
  }

  // 5. Delete associated likes on this comment (Data Integrity)
  // Find and delete all 'Like' documents where the 'comment' field matches this commentId
  const deletedLikesResult = await Like.deleteMany({ comment: commentId });
  console.log(
    `Deleted ${deletedLikesResult.deletedCount} likes associated with comment ${commentId}`
  );

  // 6. Delete the comment document from the database
  const result = await Comment.deleteOne({ _id: commentId });

  // 7. Handle Deletion Failure
  if (result.deletedCount === 0) {
    // This case indicates that the comment was not found/deleted, possibly due to a race condition
    throw new ApiError(
      500,
      "Something went wrong while deleting the comment, or comment was deleted concurrently."
    );
  }

  // 8. Return Success Response
  return res
    .status(200) // 200 OK for a successful deletion
    .json(
      new ApiResponse(
        200,
        null, // No data needed in response for deletion
        "Comment deleted successfully"
      )
    );
});

export { getVideoComments, addComment, updateComment, deleteComment };
