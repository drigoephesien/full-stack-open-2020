const supertest = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const mockDb = require("./mockDb_helper");
const helper = require("./test_helper");
const User = require("../models/user");
const Blog = require("../models/blog");
const app = require("../app");

const api = supertest(app);

jest.setTimeout(60000);
const globals = {};

beforeAll(async () => mockDb.connect());

beforeEach(async () => {
  await mockDb.clearDatabase();

  const newUsers = helper.initialUsers.map(user => new User(user));
  const userPromises = newUsers.map(user => user.save());
  await Promise.all(userPromises);

  const savedUsers = await helper.getUsersInDb();

  const userForToken = {
    username: savedUsers[0].username,
    id: savedUsers[0].id
  };

  const token = jwt.sign(userForToken, process.env.SECRET_KEY);
  globals.token = `Bearer ${token}`;
  globals.tokenId = userForToken.id;

  const validUserId = savedUsers[0].id;

  const newBlogs = helper.initialBlogs.map(
    blog => new Blog({ ...blog, user: validUserId })
  );
  const blogsPromises = newBlogs.map(blog => blog.save());
  await Promise.all(blogsPromises);
});

// TEST FETCHING USERS COLLECTION
describe("Fetching existing users collection: GET /api/users", () => {
  test("returns all users on server as JSON", async () => {
    const response = await api
      .get("/api/users")
      .expect("Content-Type", /application\/json/);
    expect(response.body.length).toBe(helper.initialUsers.length);
  });

  test("returns users without exposing sensitive data", async () => {
    const response = await api.get("/api/users");
    const userProps = Object.getOwnPropertyNames(response.body[0]);
    expect(userProps).not.toContain("passwordHash");
  });
});

// TEST CREATING USERS
describe("Sending a user: POST /api/users", () => {
  test("fails with status 400 if the user is invalid", async () => {
    await api
      .post("/api/users")
      .send({ name: "name", password: "password" })
      .set("Content-Type", "application/json")
      .expect(400);

    await api
      .post("/api/users")
      .send({ name: "name", username: "username" })
      .set("Content-Type", "application/json")
      .expect(400);
  });

  // TEST VALIDATION ERRORS
  describe("fails with status 422 and error hints if...", () => {
    test("username is not unique", async () => {
      const existingUsername = helper.initialUsers[0].username;

      const response = await api
        .post("/api/users")
        .set("Content-Type", "application/json")
        .send({ username: existingUsername, name: "Name", password: "passw" })
        .expect(422);

      const isUniqueError = /unique/.test(response.body.error.message);
      expect(isUniqueError).toBe(true);
      expect(response.body.error.message.toLowerCase()).toContain("username");

      const usersAtEnd = await helper.getUsersInDb();
      expect(usersAtEnd.length).toBe(helper.initialUsers.length);
    });

    test("username is less than 3 chars", async () => {
      const response = await api
        .post("/api/users")
        .set("Content-Type", "application/json")
        .send({ username: "UM", name: "Uchiha", password: "password" })
        .expect(422);

      const minLengthRegex = /at least \(\d+\)/;
      const isMinLengthError = minLengthRegex.test(response.body.error.message);
      expect(isMinLengthError).toBe(true);
      expect(response.body.error.message.toLowerCase()).toContain("username");

      const usersAtEnd = await helper.getUsersInDb();
      expect(usersAtEnd.length).toBe(helper.initialUsers.length);
    });

    test("password is less than 3 chars", async () => {
      const response = await api
        .post("/api/users")
        .set("Content-Type", "application/json")
        .send({ username: "madara", name: "Madara", password: "pw" })
        .expect(422);

      const minLengthRegex = /at least \(\d+\)/;
      const isMinLengthError = minLengthRegex.test(response.body.error.message);
      expect(isMinLengthError).toBe(true);
      expect(response.body.error.message.toLowerCase()).toContain("password");

      const usersAtEnd = await helper.getUsersInDb();
      expect(usersAtEnd.length).toBe(helper.initialUsers.length);
    });
  });

  test("saves the user to db if valid", async () => {
    const userToSave = {
      username: "admin",
      name: "Admin",
      password: "admin"
    };

    await api
      .post("/api/users")
      .set("Content-Type", "application/json")
      .send(userToSave)
      .expect(201);

    const usersAtEnd = await helper.getUsersInDb();
    expect(usersAtEnd.length).toBe(helper.initialUsers.length + 1);

    const usernames = usersAtEnd.map(user => user.username);
    expect(usernames).toContain(userToSave.username);
  });
});

// TEST LOGGING IN USERS
describe("Logging in a user: POST /api/login", () => {
  test("fails with status 401 if credentials are invalid", async () => {
    const fakeUsername = "emanresu";
    const fakePassword = "drowssap";

    const isNotValidCreds = helper.initialUsers.every(user => {
      return user.username !== fakeUsername && user.password !== fakePassword;
    });

    expect(isNotValidCreds).toBe(true);

    await api
      .post("/api/login")
      .send({ username: fakeUsername, password: "password" })
      .expect(401);

    await api
      .post("/api/login")
      .send({ username: "username", password: fakePassword })
      .expect(401);
  });

  test("authenticates user if credentials are valid", async () => {
    const validUser = helper.plainUsers[0];

    const response = await api
      .post("/api/login")
      .send({ username: validUser.username, password: validUser.password })
      .expect(200);

    const { token } = response.body;
    expect(token).toBeDefined();

    const decodedToken = jwt.verify(token, process.env.SECRET_KEY);
    expect(decodedToken.username).toBe(validUser.username);
  });
});

// TEST FETCHING BLOGS COLLECTION
describe("Fetching existing blogs collection: GET /api/blogs", () => {
  test("returns blogs as json", async () => {
    await api.get("/api/blogs").expect("Content-Type", /application\/json/);
  });

  test("returns all blogs on server", async () => {
    const response = await api.get("/api/blogs");
    expect(response.body.length).toBe(helper.initialBlogs.length);
  });

  test("returns blogs that each have an 'id' prop", async () => {
    const response = await api.get("/api/blogs");
    expect(response.body[0].id).toBeDefined();
  });

  test("returns blogs w/ user prop as ref ids to who added them", async () => {
    const response = await api.get("/api/blogs");
    expect(response.body[0].user).toBeDefined();
    let isValidId;
    if (typeof response.body[0].user === "object") {
      isValidId = mongoose.Types.ObjectId.isValid(response.body[0].user.id);
    } else {
      isValidId = mongoose.Types.ObjectId.isValid(response.body[0].user);
    }
    expect(isValidId).toBe(true);
  });
});

// TEST FETCHING BLOG MEMBERS
describe("Fetching specific blog member: GET /api/blogs/id", () => {
  test("fails with status 400 if the id is invalid", async () => {
    const invalidId = "spamandeggsandspam";
    await api.get(`/api/blogs/${invalidId}`).expect(400);
  });

  test("fails with status 404 if the blog doesn't exist", async () => {
    const deletedValidId = await helper.getDeletedValidId();
    await api.get(`/api/blogs/${deletedValidId}`).expect(404);
  });

  test("succeeds if the member with that id exists", async () => {
    const blogsInDb = await helper.getBlogsInDb();
    const blogToView = blogsInDb[0];

    const response = await api
      .get(`/api/blogs/${blogToView.id}`)
      .expect(200)
      .expect("Content-Type", /application\/json/);

    expect(response.body).toEqual(
      expect.objectContaining({
        title: blogToView.title,
        author: blogToView.author,
        url: blogToView.url,
        likes: blogToView.likes,
        id: blogToView.id,
        user: blogToView.user.toString()
      })
    );
  });
});

// TEST CREATING BLOGS
describe("Sending a blog: POST /api/blogs", () => {
  test("fails with status 401 if unauthorized", async () => {
    const newBlog = new Blog(helper.validBlog);

    await api
      .post("/api/blogs")
      .send(newBlog)
      .expect(401);
  });

  test("fails with status 400 if authorized but the blog is invalid", async () => {
    let newBlog = new Blog(helper.blogWithMissingTitle);

    await api
      .post("/api/blogs")
      .set("Authorization", globals.token)
      .set("Content-Type", "application/json")
      .send(newBlog)
      .expect(400);

    newBlog = new Blog(helper.blogWithMissingUrl);

    await api
      .post("/api/blogs")
      .set("Authorization", globals.token)
      .set("Content-Type", "application/json")
      .send(newBlog)
      .expect(400);
  });

  describe("succeeds if the new blog is valid...", () => {
    test("with the new blog saved to db", async () => {
      const newBlog = new Blog(helper.validBlog);

      await api
        .post("/api/blogs")
        .set("Authorization", globals.token)
        .set("Content-Type", "application/json")
        .send(newBlog)
        .expect(201)
        .expect("Content-Type", /application\/json/);

      const blogsAtEnd = await helper.getBlogsInDb();
      expect(blogsAtEnd.length).toBe(helper.initialBlogs.length + 1);
      const titles = blogsAtEnd.map(blog => blog.title);
      expect(titles).toContain(helper.validBlog.title);
    });

    test("and the saved blog referencing the user who added it", async () => {
      const newBlog = new Blog(helper.validBlog);

      await api
        .post("/api/blogs")
        .set("Authorization", globals.token)
        .set("Content-Type", "application/json")
        .send(newBlog)
        .expect(201);

      const latestBlog = await helper.getLatestBlogInDb();
      expect(latestBlog.user.toString()).toBe(globals.tokenId);
    });

    test("and the blog's 'likes' set to 0 if missing", async () => {
      const newBlog = new Blog(helper.blogWithMissingLikes);

      const response = await api
        .post("/api/blogs")
        .set("Authorization", globals.token)
        .set("Content-Type", "application/json")
        .send(newBlog);

      expect(response.body.likes).toBe(0);
    });
  });
});

// TEST DELETING BLOG MEMBERS
describe("Deleting specific blog member: DELETE /api/blogs/id", () => {
  test("fails with status 400 if the id is invalid", async () => {
    const invalidId = "spamandeggsandspam";
    await api.delete(`/api/blogs/${invalidId}`).expect(400);
  });

  test("receives status 404 if the blog doesn't exist", async () => {
    const deletedValidId = await helper.getDeletedValidId();
    await api.delete(`/api/blogs/${deletedValidId}`).expect(404);
  });

  test("deletes the blog member with that id if valid", async () => {
    const blogsatStart = await helper.getBlogsInDb();
    const blogToDelete = blogsatStart[0];

    await api.delete(`/api/blogs/${blogToDelete.id}`).expect(204);

    const blogsAtEnd = await helper.getBlogsInDb();
    const titles = blogsAtEnd.map(blog => blog.title);
    expect(titles).not.toContain(blogToDelete.title);
  });
});

// TEST REPLACING BLOG MEMBERS
describe("Replacing specific blog member: PUT /api/blogs/id", () => {
  test("fails with status 400 if the id is invalid", async () => {
    const invalidId = "spamandeggsandspam";
    await api.put(`/api/blogs/${invalidId}`).expect(400);
  });

  test("fails with status 400 if the replacement is invalid", async () => {
    const blogsatStart = await helper.getBlogsInDb();
    const blogToReplace = blogsatStart[0];
    const replacementWithNoTitle = { ...blogToReplace, title: null };
    const replacementWithNoUrl = { ...blogToReplace, url: null };

    await api
      .put(`/api/blogs/${blogToReplace.id}`)
      .set("Content-Type", "application/json")
      .send(replacementWithNoTitle)
      .expect(400);

    await api
      .put(`/api/blogs/${blogToReplace.id}`)
      .set("Content-Type", "application/json")
      .send(replacementWithNoUrl)
      .expect(400);
  });

  test("receives status 404 if the blog doesn't exist", async () => {
    const deletedValidId = await helper.getDeletedValidId();
    await api.put(`/api/blogs/${deletedValidId}`).expect(404);
  });

  test("replaces the blog member bearing that id if valid", async () => {
    const blogsatStart = await helper.getBlogsInDb();
    const blogToReplace = blogsatStart[0];
    const replacement = { ...blogToReplace, likes: 9999 };

    await api
      .put(`/api/blogs/${blogToReplace.id}`)
      .set("Content-Type", "application/json")
      .send(replacement)
      .expect(200);

    const blogsAtEnd = await helper.getBlogsInDb();
    const replacedBlog = blogsAtEnd.filter(b => b.id === replacement.id)[0];
    expect(replacedBlog.likes).toBe(replacement.likes);
  });
});

afterAll(async () => {
  await mockDb.closeDatabase();
  await new Promise(resolve => setTimeout(() => resolve(), 0)); // avoid jest open handle error
});
