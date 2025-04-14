const mongoose = require('mongoose')
mongoose.set('strictQuery', false)

require('dotenv').config()

const MONGODB_URI = process.env.MONGODB_URI

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('connected to MongoDB')
    })
    .catch((error) => {
        console.log('error connection to MongoDB:', error.message)
        process.exit(1)
    })

const {ApolloServer} = require('@apollo/server')
const {startStandaloneServer} = require('@apollo/server/standalone')

const Book = require('./models/book')
const Author = require('./models/author')

const typeDefs = `
  type Author {
    name: String!
    id: ID!
    born: Int
    bookCount: Int!
  }
  
  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]!
    id: ID!
  }
  
  type Query {
    bookCount: Int!
    authorCount: Int!
    allBooks(author: String, genre: String): [Book!]!
    allAuthors: [Author!]!
  }
  
  type Mutation {
    addBook(
      title: String!, 
      published: Int!, 
      author: String!, 
      genres: [String!]!
    ): Book!
    
    editAuthor(
      name: String!
      setBornTo: Int!
    ): Author
  }
`

const resolvers = {
    Query: {
        bookCount: () => Book.collection.countDocuments(),
        authorCount: () => Author.collection.countDocuments(),
        allBooks: async (_, {author = undefined, genre = undefined}) => {
            return Book.find({})

        },
        allAuthors: async () => {
            return Author.find({})
        },
    },
    Mutation: {
        addBook: async (_, {title, published, author, genres}) => {
            let bookAuthor = await Author.findOne({ name: author })

            if (!bookAuthor) {
                bookAuthor = await (new Author({ name: author })).save()
                    .then(result => {
                        console.log('author saved!', result)
                        return result
                    })
            }

            const book = new Book({
                title,
                published,
                author: bookAuthor,
                genres
            })

            return book.save()

        },
        editAuthor: (_, {name, setBornTo}) => {
            // const author = authors.findIndex(a => a.name === name)
            // if (author === -1) return null
            // const updatedAuthor = { ...authors[author], born: setBornTo }
            // authors = [
            //   ...authors.slice(0, author),
            //   updatedAuthor,
            //   ...authors.slice(author + 1)
            // ]
            // return updatedAuthor
        },
    },
}

const server = new ApolloServer({
    typeDefs,
    resolvers,
})

startStandaloneServer(server, {
    listen: {port: 4000},
}).then(({url}) => {
    console.log(`Server ready at ${url}`)
})
